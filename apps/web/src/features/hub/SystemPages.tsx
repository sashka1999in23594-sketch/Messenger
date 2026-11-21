/**
 * Системные окна: проводник облака, центр безопасности (журнал, разрешения,
 * корзина, резервные копии) и консоль администратора.
 */
import { useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, BadgeCheck, FileText, Folder, History, RotateCcw, ShieldCheck, Terminal, Trash2 } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { useSession } from '../../shared/stores/session';
import { openPath } from '../desktop/fx';
import { PERM_LABEL } from './catalog';
import { useCloud } from './cloud';
import { openItem } from './DeskIcons';
import './hub.css';

export function CloudPage() {
  const [params] = useSearchParams();
  const folder = params.get('folder');
  const fileId = params.get('file');
  const items = useCloud((s) => s.items);
  const file = fileId ? items.find((i) => i.id === fileId) : undefined;
  if (file)
    return (
      <div className="hubpage">
        <h1 className="hubpage__title">
          <FileText size={22} /> {file.name}
        </h1>
        <div className="hubcard">
          <div>Тип: {file.kind === 'file' ? file.mime || 'файл' : file.kind}</div>
          {file.size !== undefined && <div>Размер: {(file.size / 1024).toFixed(1)} КБ</div>}
          <div>Создан: {new Date(file.createdAt).toLocaleString('ru')}</div>
          <div>Изменён: {new Date(file.updatedAt).toLocaleString('ru')}</div>
          {file.quarantined && <div className="notice notice--warning">Файл скачан из интернета и открывается только в песочнице</div>}
        </div>
      </div>
    );
  const here = items.filter((i) => i.parent === folder);
  const title = folder ? (items.find((i) => i.id === folder)?.name ?? 'Папка') : 'Облако Sunnet';
  return (
    <div className="hubpage">
      <h1 className="hubpage__title">
        <Folder size={22} /> {title}
      </h1>
      <div className="cloud-grid">
        {here.map((i, n) => (
          <button key={i.id} type="button" className="cloud-cell" style={{ '--i': n } as CSSProperties} onDoubleClick={() => openItem(i)}>
            {i.kind === 'folder' ? <Folder size={42} /> : <FileText size={38} />}
            <span className="ellipsis">{i.name}</span>
          </button>
        ))}
        {!here.length && <div className="hub-muted">Папка пуста. Перетащите сюда значки со стола.</div>}
      </div>
    </div>
  );
}

type SecTab = 'log' | 'perms' | 'trash' | 'backup' | 'installs';

export function SecurityPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as SecTab) || 'log';
  const s = useCloud();
  const tabs: { id: SecTab; label: string; icon: typeof History }[] = [
    { id: 'log', label: 'Журнал', icon: History },
    { id: 'perms', label: 'Разрешения', icon: ShieldCheck },
    { id: 'installs', label: 'Установки', icon: Archive },
    { id: 'trash', label: `Корзина (${s.trash.length})`, icon: Trash2 },
    { id: 'backup', label: 'Резервные копии', icon: RotateCcw },
  ];
  const appsWithGrants = s.items.filter((i) => Object.values(s.grants[i.id] ?? {}).some(Boolean));
  return (
    <div className="hubpage">
      <div className="sec-hero">
        <ShieldCheck size={34} />
        <div>
          <div className="sec-hero__t">Облако защищено</div>
          <div className="sec-hero__s">Изоляция приложений · корзина 30 дней · защита от массового удаления · отдельные разрешения</div>
        </div>
      </div>
      <nav className="orbit-tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={cn('orbit-tab', tab === t.id && 'orbit-tab--on')} onClick={() => setParams({ tab: t.id })}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </nav>
      {tab === 'log' && (
        <div className="hublist">
          {s.secLog.map((e, i) => (
            <div key={i} className={`hublist__row hublist__row--${e.level}`}>
              <span>{e.text}</span>
              <span className="hub-muted">{new Date(e.at).toLocaleString('ru')}</span>
            </div>
          ))}
          {!s.secLog.length && <div className="hub-muted">Событий пока нет</div>}
        </div>
      )}
      {tab === 'perms' && (
        <>
          <h3 className="orbit-h">Сейчас разрешено</h3>
          <div className="hublist">
            {appsWithGrants.map((i) => (
              <div key={i.id} className="hublist__row">
                <b>{i.name}</b>
                <span className="hub-chips">
                  {Object.entries(s.grants[i.id] ?? {})
                    .filter(([, on]) => on)
                    .map(([p]) => (
                      <button key={p} type="button" className="chip" onClick={() => s.grant(i.id, p as keyof typeof PERM_LABEL, false)} title="Отозвать">
                        {PERM_LABEL[p as keyof typeof PERM_LABEL]} ✕
                      </button>
                    ))}
                </span>
              </div>
            ))}
            {!appsWithGrants.length && <div className="hub-muted">Ни у одного приложения нет разрешений</div>}
          </div>
          <h3 className="orbit-h">История</h3>
          <div className="hublist">
            {s.permLog.map((e, i) => (
              <div key={i} className="hublist__row">
                <span>
                  {e.granted ? '✅' : '⛔'} {e.name}: {PERM_LABEL[e.perm]}
                </span>
                <span className="hub-muted">{new Date(e.at).toLocaleString('ru')}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'installs' && (
        <div className="hublist">
          {s.installs.map((e, i) => (
            <div key={i} className="hublist__row">
              <span>{e.action === 'install' ? '⬇ Установлено' : '🗑 Удалено'}: {e.appId}</span>
              <span className="hub-muted">{new Date(e.at).toLocaleString('ru')}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'trash' && (
        <div className="hublist">
          {s.trash.map((t) => (
            <div key={t.id} className="hublist__row">
              <span>{t.name}</span>
              <span className="hub-chips">
                <span className="hub-muted">удалится {new Date(t.deletedAt + 30 * 86400e3).toLocaleDateString('ru')}</span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => s.restore(t.id)}>
                  <RotateCcw size={14} /> Восстановить
                </button>
              </span>
            </div>
          ))}
          {!s.trash.length && <div className="hub-muted">Корзина пуста</div>}
        </div>
      )}
      {tab === 'backup' && (
        <div className="hubcard">
          <p>Облако хранит версии проектов и файлов. Перед каждым обновлением Sunnet делает снимок, чтобы откатиться, если обновление не удалось.</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const blob = new Blob([JSON.stringify({ cloud: localStorage.getItem('sunnet.cloud'), studio: localStorage.getItem('sunnet.studio') })], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `sunnet-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
            }}
          >
            Скачать резервную копию
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Консоль администратора: команды вида /user.block("sashka", duration: 7d).
 * Разбор — на клиенте, выполнение — только на сервере, который проверяет
 * роль. Каждая команда (включая вход в чужой аккаунт) пишется в журнал
 * администраторов; пользователю вход не показывается.
 */
const COMMANDS: [string, string][] = [
  ['/user.block("ник", duration: 7d)', 'Заблокировать на срок (m, h, d)'],
  ['/user.unblock("ник")', 'Снять блокировку'],
  ['/user.verify("ник")', 'Выдать галочку'],
  ['/user.unverify("ник")', 'Снять галочку'],
  ['/user.role("ник", "moderator")', 'Назначить роль: user, moderator, admin'],
  ['/user.impersonate("ник")', 'Войти в аккаунт (запись в журнал админов)'],
  ['/user.sessions("ник")', 'Показать сеансы'],
  ['/user.logout("ник")', 'Завершить все сеансы'],
  ['/app.verify("id")', 'Верифицировать приложение'],
  ['/server.verify("id")', 'Верифицировать сервер'],
  ['/help', 'Список команд'],
];

export function parseCommand(line: string): { name: string; args: string[]; opts: Record<string, string> } | null {
  const m = /^\/([a-z]+(?:\.[a-z]+)?)\s*(?:\((.*)\))?\s*$/i.exec(line.trim());
  if (!m) return null;
  const args: string[] = [];
  const opts: Record<string, string> = {};
  for (const part of (m[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const kv = /^([a-z]+)\s*:\s*(.+)$/i.exec(part);
    if (kv) opts[kv[1]!] = kv[2]!.replace(/^"|"$/g, '');
    else args.push(part.replace(/^"|"$/g, ''));
  }
  return { name: m[1]!, args, opts };
}

export function AdminConsole() {
  const me = useSession((s) => s.me);
  const [lines, setLines] = useState<{ t: 'in' | 'out' | 'err'; s: string }[]>([{ t: 'out', s: 'Sunnet Admin · введите /help' }]);
  const [cmd, setCmd] = useState('');
  const [hist, setHist] = useState<string[]>([]);
  const run = () => {
    const c = parseCommand(cmd);
    const out: typeof lines = [{ t: 'in', s: cmd }];
    if (!c) out.push({ t: 'err', s: 'Не понял команду. Формат: /объект.действие("аргумент", опция: значение)' });
    else if (c.name === 'help') COMMANDS.forEach(([a, b]) => out.push({ t: 'out', s: `${a.padEnd(38)} ${b}` }));
    else if (!COMMANDS.some(([a]) => a.startsWith(`/${c.name}`))) out.push({ t: 'err', s: `Нет команды /${c.name}` });
    else if (me?.role === 'user') out.push({ t: 'err', s: 'Нужны права администратора. Сервер отклонит команду.' });
    else out.push({ t: 'out', s: `→ /${c.name} ${JSON.stringify(c.args)} ${JSON.stringify(c.opts)} — отправлено на сервер` });
    setLines((l) => [...l, ...out]);
    setHist((h) => [cmd, ...h]);
    setCmd('');
  };
  return (
    <div className="admin">
      <div className="admin__head">
        <Terminal size={18} /> Консоль администратора
        <span className="admin__me">
          {me?.displayName} {me?.role !== 'user' && <BadgeCheck size={15} className="orbit-ok" />}
        </span>
      </div>
      <div className="admin__out">
        {lines.map((l, i) => (
          <div key={i} className={`admin__l admin__l--${l.t}`}>
            {l.t === 'in' ? '› ' : ''}
            {l.s}
          </div>
        ))}
      </div>
      <div className="admin__in">
        <span>›</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cmd.trim()) run();
            if (e.key === 'ArrowUp' && hist[0]) setCmd(hist[0]);
          }}
          placeholder='/user.block("sashka", duration: 7d)'
          spellCheck={false}
          autoFocus
        />
      </div>
      <div className="admin__hints">
        {COMMANDS.slice(0, 6).map(([a]) => (
          <button key={a} type="button" className="chip" onClick={() => setCmd(a)}>
            {a}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => openPath('/admin/reports')}>
          Жалобы
        </button>
      </div>
    </div>
  );
}
