/**
 * «Луч» — язык консоли владельца Sunnet. Простой, как калькулятор, но с переменными,
 * циклами, условиями и конвейерами:
 *
 *   let ник = "sashka"
 *   user.info(ник)
 *   user.recent(50) | where role == "user" | sort created_at desc | take 5 | pick username
 *   for u in user.blocked() { user.unblock(u) }
 *   if post.today() > 100 { echo "Горячий день!" } else { echo "Спокойно" }
 *   repeat 3 { echo "Привет, {ник}" }
 *
 * Выполняется на сервере, без eval: свой разбор и обход дерева. Лимиты — не больше
 * 300 вызовов команд, 5000 шагов циклов и 5 секунд на скрипт.
 */
import type { Command, Parsed, Result, Run } from './commands.js';
import { rowLine } from './entities.js';

type Val = null | boolean | number | string | Val[] | { [k: string]: Val };
export interface OutLine {
  kind: 'ok' | 'fail' | 'info';
  text: string;
}

class ScriptError extends Error {}

// ─── Лексер ──────────────────────────────────────────────────────────────────
type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'nl' };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const isId = (c: string) => /[\p{L}\p{N}_]/u.test(c);
  while (i < src.length) {
    const c = src[i]!;
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n' || c === ';') {
      out.push({ t: 'nl' });
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '«') {
      const end = c === '«' ? '»' : c;
      let s = '';
      i++;
      while (i < src.length && src[i] !== end) {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        s += src[i++];
      }
      if (i >= src.length) throw new ScriptError('Не закрыта кавычка');
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    if (/[0-9]/.test(c)) {
      let s = '';
      while (i < src.length && /[0-9.]/.test(src[i]!)) s += src[i++];
      // 7d, 12h, 30m — срок пишется без кавычек
      if (i < src.length && /[a-zа-я]/i.test(src[i]!)) {
        while (i < src.length && isId(src[i]!)) s += src[i++];
        out.push({ t: 'str', v: s });
      } else out.push({ t: 'num', v: Number(s) });
      continue;
    }
    // «/» перед именем команды — необязательный знак команды
    if (c === '/' && i + 1 < src.length && isId(src[i + 1]!)) {
      i++;
      continue;
    }
    if (isId(c)) {
      let s = '';
      while (i < src.length && (isId(src[i]!) || (src[i] === '.' && i + 1 < src.length && isId(src[i + 1]!)))) s += src[i++];
      out.push({ t: 'id', v: s });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('(){}[],:=<>+-*|!%'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new ScriptError(`Непонятный символ «${c}»`);
  }
  return out;
}

// ─── Дерево ──────────────────────────────────────────────────────────────────
type Expr =
  | { k: 'lit'; v: Val }
  | { k: 'str'; parts: (string | string[])[] }
  | { k: 'list'; items: Expr[] }
  | { k: 'path'; path: string[] }
  | { k: 'call'; name: string; args: Expr[]; named: [string, Expr][] }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'neg'; a: Expr }
  | { k: 'pipe'; src: Expr; op: string; arg?: Expr; fields?: string[]; dir?: 'asc' | 'desc' };
type Stmt =
  | { k: 'let'; name: string; e: Expr }
  | { k: 'expr'; e: Expr }
  | { k: 'echo'; e: Expr }
  | { k: 'for'; v: string; e: Expr; body: Stmt[] }
  | { k: 'repeat'; e: Expr; body: Stmt[] }
  | { k: 'if'; e: Expr; body: Stmt[]; else?: Stmt[] };

const KEYWORDS = new Set(['let', 'for', 'in', 'repeat', 'if', 'else', 'echo', 'print', 'and', 'or', 'not', 'true', 'false', 'null', 'пусть', 'для', 'в', 'повтор', 'если', 'иначе', 'вывод', 'и', 'или', 'не', 'да', 'нет']);
const KW: Record<string, string> = { пусть: 'let', для: 'for', в: 'in', повтор: 'repeat', если: 'if', иначе: 'else', вывод: 'echo', print: 'echo', и: 'and', или: 'or', не: 'not', да: 'true', нет: 'false' };
const kw = (v: string) => KW[v] ?? v;

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(o = 0) {
    return this.toks[this.i + o];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t?.t === 'op' && t.v === v;
  }
  isKw(v: string) {
    const t = this.peek();
    return t?.t === 'id' && kw(t.v) === v;
  }
  eat(v: string) {
    if (!this.isOp(v)) throw new ScriptError(`Ожидалось «${v}»`);
    this.i++;
  }
  ident(): string {
    const t = this.peek();
    if (t?.t !== 'id') throw new ScriptError('Ожидалось имя');
    this.i++;
    return t.v;
  }
  skipNl() {
    while (this.peek()?.t === 'nl') this.i++;
  }
  program(): Stmt[] {
    const out: Stmt[] = [];
    this.skipNl();
    while (this.i < this.toks.length) {
      out.push(this.stmt());
      this.skipNl();
    }
    return out;
  }
  block(): Stmt[] {
    this.skipNl();
    this.eat('{');
    const out: Stmt[] = [];
    this.skipNl();
    while (!this.isOp('}')) {
      if (this.i >= this.toks.length) throw new ScriptError('Не закрыта фигурная скобка «}»');
      out.push(this.stmt());
      this.skipNl();
    }
    this.eat('}');
    return out;
  }
  stmt(): Stmt {
    if (this.isKw('let')) {
      this.i++;
      const name = this.ident();
      this.eat('=');
      return { k: 'let', name, e: this.expr() };
    }
    if (this.isKw('echo')) {
      this.i++;
      return { k: 'echo', e: this.expr() };
    }
    if (this.isKw('for')) {
      this.i++;
      const v = this.ident();
      if (!this.isKw('in')) throw new ScriptError('Ожидалось «in»: for u in …');
      this.i++;
      const e = this.expr();
      return { k: 'for', v, e, body: this.block() };
    }
    if (this.isKw('repeat')) {
      this.i++;
      const e = this.expr();
      return { k: 'repeat', e, body: this.block() };
    }
    if (this.isKw('if')) {
      this.i++;
      const e = this.expr();
      const body = this.block();
      const save = this.i;
      this.skipNl();
      if (this.isKw('else')) {
        this.i++;
        if (this.isKw('if')) return { k: 'if', e, body, else: [this.stmt()] };
        return { k: 'if', e, body, else: this.block() };
      }
      this.i = save;
      return { k: 'if', e, body };
    }
    // name = expr — присваивание без let
    const t = this.peek();
    if (t?.t === 'id' && this.isOp('=', 1) && !KEYWORDS.has(t.v)) {
      this.i += 2;
      return { k: 'let', name: t.v, e: this.expr() };
    }
    return { k: 'expr', e: this.expr() };
  }
  /** Глубина «без конвейера»: внутри where/take условие не должно съедать следующий «|» */
  noPipe = 0;
  expr(): Expr {
    return this.or();
  }
  /** Конвейер связывается плотнее сравнения: user.blocked() | count >= 1 */
  piped(): Expr {
    let e = this.add();
    while (!this.noPipe && this.isOp('|')) {
      this.i++;
      const op = this.ident().toLowerCase();
      if (op === 'where' || op === 'take' || op === 'skip' || op === 'map') {
        this.noPipe++;
        const arg = this.or();
        this.noPipe--;
        e = { k: 'pipe', src: e, op, arg };
      }
      else if (op === 'sort') {
        const fields = [this.ident()];
        let dir: 'asc' | 'desc' = 'asc';
        const t = this.peek();
        if (t?.t === 'id' && (t.v === 'desc' || t.v === 'asc')) {
          dir = t.v;
          this.i++;
        }
        e = { k: 'pipe', src: e, op, fields, dir };
      } else if (op === 'pick' || op === 'sum' || op === 'avg' || op === 'unique' || op === 'group') {
        const fields = [this.ident()];
        while (this.isOp(',')) {
          this.i++;
          fields.push(this.ident());
        }
        e = { k: 'pipe', src: e, op, fields };
      } else if (['count', 'first', 'last', 'reverse', 'lines'].includes(op)) e = { k: 'pipe', src: e, op };
      else throw new ScriptError(`Нет операции конвейера «${op}». Есть: where, sort, take, skip, pick, count, first, last, sum, avg, unique, group, reverse, map`);
    }
    return e;
  }
  or(): Expr {
    let a = this.and();
    while (this.isKw('or') || this.isOp('||')) {
      this.i++;
      a = { k: 'bin', op: 'or', a, b: this.and() };
    }
    return a;
  }
  and(): Expr {
    let a = this.not();
    while (this.isKw('and') || this.isOp('&&')) {
      this.i++;
      a = { k: 'bin', op: 'and', a, b: this.not() };
    }
    return a;
  }
  not(): Expr {
    if (this.isKw('not') || this.isOp('!')) {
      this.i++;
      return { k: 'not', a: this.not() };
    }
    return this.cmp();
  }
  cmp(): Expr {
    const a = this.piped();
    for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
      if (this.isOp(op)) {
        this.i++;
        return { k: 'bin', op, a, b: this.piped() };
      }
    }
    const t = this.peek();
    if (t?.t === 'id' && (t.v === 'contains' || t.v === 'содержит')) {
      this.i++;
      return { k: 'bin', op: 'contains', a, b: this.piped() };
    }
    return a;
  }
  add(): Expr {
    let a = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      a = { k: 'bin', op, a, b: this.mul() };
    }
    return a;
  }
  mul(): Expr {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('%')) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      a = { k: 'bin', op, a, b: this.unary() };
    }
    return a;
  }
  unary(): Expr {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'neg', a: this.unary() };
    }
    return this.primary();
  }
  primary(): Expr {
    const t = this.peek();
    if (!t) throw new ScriptError('Неожиданный конец строки');
    if (t.t === 'num') {
      this.i++;
      return { k: 'lit', v: t.v };
    }
    if (t.t === 'str') {
      this.i++;
      // «Привет, {u.username}» — подстановка значений
      const parts: (string | string[])[] = [];
      let rest = t.v;
      for (;;) {
        const m = /\{([\p{L}\p{N}_.]+)\}/u.exec(rest);
        if (!m) break;
        parts.push(rest.slice(0, m.index), m[1]!.split('.'));
        rest = rest.slice(m.index + m[0].length);
      }
      parts.push(rest);
      return parts.length === 1 ? { k: 'lit', v: t.v } : { k: 'str', parts };
    }
    if (this.isOp('(')) {
      this.i++;
      const saved = this.noPipe;
      this.noPipe = 0;
      const e = this.expr();
      this.noPipe = saved;
      this.eat(')');
      return e;
    }
    if (this.isOp('[')) {
      this.i++;
      const items: Expr[] = [];
      while (!this.isOp(']')) {
        items.push(this.expr());
        if (this.isOp(',')) this.i++;
        else if (!this.isOp(']')) throw new ScriptError('Ожидалась «,» или «]»');
      }
      this.i++;
      return { k: 'list', items };
    }
    if (t.t === 'id') {
      this.i++;
      const w = kw(t.v);
      if (w === 'true') return { k: 'lit', v: true };
      if (w === 'false') return { k: 'lit', v: false };
      if (w === 'null') return { k: 'lit', v: null };
      if (this.isOp('(')) {
        this.i++;
        const args: Expr[] = [];
        const named: [string, Expr][] = [];
        this.skipNl();
        while (!this.isOp(')')) {
          const p = this.peek();
          if (p?.t === 'id' && this.isOp(':', 1)) {
            this.i += 2;
            named.push([p.v.toLowerCase(), this.expr()]);
          } else args.push(this.expr());
          this.skipNl();
          if (this.isOp(',')) this.i++;
          else if (!this.isOp(')')) throw new ScriptError('Ожидалась «,» или «)»');
          this.skipNl();
        }
        this.i++;
        return { k: 'call', name: t.v.toLowerCase(), args, named };
      }
      return { k: 'path', path: t.v.split('.') };
    }
    throw new ScriptError(`Неожиданное «${t.t === 'op' ? t.v : '…'}»`);
  }
}

// ─── Выполнение ──────────────────────────────────────────────────────────────
const truthy = (v: Val) => !(v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));
const asNum = (v: Val) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN);
const show = (v: Val): string => {
  if (v === null) return '—';
  if (Array.isArray(v)) return v.map(show).join(', ');
  if (typeof v === 'object') return rowLine(v as Record<string, unknown>);
  return String(v);
};
/** Что передать команде вместо объекта: ник, ссылку или id */
const argText = (v: Val): string => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, Val>;
    return String(o.username ?? o.slug ?? o.handle ?? o.id ?? o.text ?? '');
  }
  return v === null ? '' : show(v);
};
const get = (v: Val, path: string[]): Val => {
  let cur = v;
  for (const p of path) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) cur = (cur as Record<string, Val>)[p] ?? null;
    else if (Array.isArray(cur) && p === 'length') cur = cur.length;
    else return null;
  }
  return cur;
};

export interface ScriptEnv {
  commands: Map<string, Command>;
  base: Omit<Run, 'cmd'>;
  onCall?: (name: string, res: Result) => void;
}

export async function runScript(src: string, env: ScriptEnv): Promise<{ ok: boolean; out: OutLine[] }> {
  const out: OutLine[] = [];
  const vars = new Map<string, Val>();
  let calls = 0;
  let steps = 0;
  const deadline = Date.now() + 5000;
  const tick = () => {
    if (++steps > 5000) throw new ScriptError('Слишком много шагов (больше 5000) — остановлено');
    if (Date.now() > deadline) throw new ScriptError('Скрипт выполнялся дольше 5 секунд — остановлено');
  };

  const call = async (e: Extract<Expr, { k: 'call' }>, scope: Map<string, Val>): Promise<Result> => {
    const def = env.commands.get(e.name);
    if (!def) {
      const near = [...env.commands.keys()].filter((n) => n.split('.')[0] === e.name.split('.')[0]).slice(0, 6);
      throw new ScriptError(`Нет команды ${e.name}.${near.length ? ` Похожие: ${near.join(', ')}` : ' Введите help.all()'}`);
    }
    if (++calls > 300) throw new ScriptError('Больше 300 вызовов команд в одном скрипте — остановлено');
    tick();
    const pos: string[] = [];
    for (const a of e.args) pos.push(argText(await ev(a, scope)));
    const named: Record<string, string> = {};
    for (const [k, a] of e.named) named[k] = argText(await ev(a, scope));
    const cmd: Parsed = { name: e.name, pos, named };
    const res = await def.run({ ...env.base, cmd });
    env.onCall?.(e.name, res);
    return res;
  };

  const ev = async (e: Expr, scope: Map<string, Val>): Promise<Val> => {
    switch (e.k) {
      case 'lit':
        return e.v;
      case 'str': {
        let s = '';
        // {имя}, {u.username} или даже {user.today} — команда без скобок
        for (const p of e.parts) s += typeof p === 'string' ? p : show(await ev({ k: 'path', path: p }, scope));
        return s;
      }
      case 'list': {
        const items: Val[] = [];
        for (const x of e.items) items.push(await ev(x, scope));
        return items;
      }
      case 'path': {
        const [head, ...rest] = e.path;
        if (!scope.has(head!) && !vars.has(head!)) {
          // Команда без скобок: user.online → user.online()
          if (env.commands.has(e.path.join('.').toLowerCase())) return ev({ k: 'call', name: e.path.join('.').toLowerCase(), args: [], named: [] }, scope);
          throw new ScriptError(`Нет переменной «${head}». Объявите: let ${head} = …`);
        }
        return get(scope.has(head!) ? scope.get(head!)! : vars.get(head!)!, rest);
      }
      case 'call': {
        const r = await call(e, scope);
        if (!r.ok) throw new ScriptError(`${e.name}: ${r.lines[0] ?? 'ошибка'}`);
        if (r.rows) return r.rows as Val[];
        // Одна строка вида «пользователей: 42» → число, чтобы с ним можно было считать
        if (r.lines.length === 1) {
          const m = /:\s*\+?(-?\d+(?:\.\d+)?)\s*$/.exec(r.lines[0]!);
          if (m) return Number(m[1]);
        }
        return r.lines.length === 1 ? r.lines[0]! : r.lines;
      }
      case 'not':
        return !truthy(await ev(e.a, scope));
      case 'neg':
        return -asNum(await ev(e.a, scope));
      case 'bin': {
        if (e.op === 'and') return truthy(await ev(e.a, scope)) && truthy(await ev(e.b, scope));
        if (e.op === 'or') return truthy(await ev(e.a, scope)) || truthy(await ev(e.b, scope));
        const a = await ev(e.a, scope);
        const b = await ev(e.b, scope);
        switch (e.op) {
          case '==':
            return show(a) === show(b);
          case '!=':
            return show(a) !== show(b);
          case '>':
            return asNum(a) > asNum(b);
          case '<':
            return asNum(a) < asNum(b);
          case '>=':
            return asNum(a) >= asNum(b);
          case '<=':
            return asNum(a) <= asNum(b);
          case 'contains':
            return Array.isArray(a) ? a.some((x) => show(x) === show(b)) : show(a).toLowerCase().includes(show(b).toLowerCase());
          case '+':
            return typeof a === 'number' && typeof b === 'number' ? a + b : Array.isArray(a) ? [...a, ...(Array.isArray(b) ? b : [b])] : show(a) + show(b);
          case '-':
            return asNum(a) - asNum(b);
          case '*':
            return asNum(a) * asNum(b);
          case '%':
            return asNum(a) % asNum(b);
        }
        return null;
      }
      case 'pipe': {
        const src = await ev(e.src, scope);
        const list: Val[] = Array.isArray(src) ? src : src === null ? [] : [src];
        const withRow = (row: Val) => {
          const s = new Map(scope);
          s.set('it', row);
          if (row && typeof row === 'object' && !Array.isArray(row)) for (const [k, v] of Object.entries(row)) if (!s.has(k)) s.set(k, v);
          return s;
        };
        switch (e.op) {
          case 'where': {
            const res: Val[] = [];
            for (const r of list) {
              tick();
              if (truthy(await ev(e.arg!, withRow(r)))) res.push(r);
            }
            return res;
          }
          case 'map': {
            const res: Val[] = [];
            for (const r of list) {
              tick();
              res.push(await ev(e.arg!, withRow(r)));
            }
            return res;
          }
          case 'take':
            return list.slice(0, Math.max(0, asNum(await ev(e.arg!, scope))));
          case 'skip':
            return list.slice(Math.max(0, asNum(await ev(e.arg!, scope))));
          case 'sort': {
            const f = e.fields![0]!;
            const key = (r: Val) => get(r, f === 'it' ? [] : [f]);
            const sorted = [...list].sort((x, y) => {
              const a = key(x);
              const b = key(y);
              const na = asNum(a);
              const nb = asNum(b);
              const c = !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : show(a).localeCompare(show(b), 'ru');
              return e.dir === 'desc' ? -c : c;
            });
            return sorted;
          }
          case 'pick':
            return list.map((r) => (e.fields!.length === 1 ? get(r, [e.fields![0]!]) : Object.fromEntries(e.fields!.map((f) => [f, get(r, [f])]))));
          case 'count':
            return list.length;
          case 'first':
            return list[0] ?? null;
          case 'last':
            return list[list.length - 1] ?? null;
          case 'reverse':
            return [...list].reverse();
          case 'lines':
            return list.map(show);
          case 'sum':
            return list.reduce<number>((s, r) => s + (asNum(get(r, [e.fields![0]!])) || 0), 0);
          case 'avg':
            return list.length ? list.reduce<number>((s, r) => s + (asNum(get(r, [e.fields![0]!])) || 0), 0) / list.length : 0;
          case 'unique':
            return [...new Set(list.map((r) => show(get(r, [e.fields![0]!]))))];
          case 'group': {
            const m = new Map<string, number>();
            for (const r of list) m.set(show(get(r, [e.fields![0]!])), (m.get(show(get(r, [e.fields![0]!]))) ?? 0) + 1);
            return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ [e.fields![0]!]: k, n }));
          }
        }
        return null;
      }
    }
  };

  const print = (v: Val) => {
    if (Array.isArray(v)) {
      if (!v.length) out.push({ kind: 'info', text: 'Пусто' });
      for (const x of v.slice(0, 500)) out.push({ kind: 'ok', text: show(x) });
      if (v.length > 500) out.push({ kind: 'info', text: `…и ещё ${v.length - 500}` });
    } else out.push({ kind: 'ok', text: show(v) });
  };

  const exec = async (body: Stmt[], scope: Map<string, Val>): Promise<void> => {
    for (const s of body) {
      tick();
      switch (s.k) {
        case 'let':
          if (scope.size && scope.has(s.name)) scope.set(s.name, await ev(s.e, scope));
          else vars.set(s.name, await ev(s.e, scope));
          break;
        case 'echo':
          print(await ev(s.e, scope));
          break;
        case 'expr':
          // Команда сама по себе — печатаем её ответ как есть (✓ или !)
          if (s.e.k === 'call') {
            const r = await call(s.e, scope);
            for (const text of r.lines) out.push({ kind: r.ok ? 'ok' : 'fail', text });
          } else print(await ev(s.e, scope));
          break;
        case 'if':
          if (truthy(await ev(s.e, scope))) await exec(s.body, scope);
          else if (s.else) await exec(s.else, scope);
          break;
        case 'repeat': {
          const n = Math.min(1000, Math.max(0, asNum(await ev(s.e, scope)) || 0));
          for (let i = 0; i < n; i++) {
            const inner = new Map(scope);
            inner.set('i', i + 1);
            await exec(s.body, inner);
          }
          break;
        }
        case 'for': {
          const src = await ev(s.e, scope);
          const list: Val[] = Array.isArray(src) ? src : typeof src === 'number' ? Array.from({ length: Math.min(1000, src) }, (_, i) => i + 1) : [src];
          for (const item of list) {
            const inner = new Map(scope);
            inner.set(s.v, item);
            await exec(s.body, inner);
          }
          break;
        }
      }
    }
  };

  try {
    if (src.length > 5000) throw new ScriptError('Скрипт длиннее 5000 символов');
    const prog = new Parser(lex(src)).program();
    await exec(prog, new Map());
    return { ok: !out.some((l) => l.kind === 'fail'), out: out.length ? out : [{ kind: 'info', text: 'Готово' }] };
  } catch (e) {
    out.push({ kind: 'fail', text: e instanceof ScriptError ? e.message : 'Ошибка выполнения скрипта' });
    return { ok: false, out };
  }
}
