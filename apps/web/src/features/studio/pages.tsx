/**
 * Страницы вокруг Студии: запуск опубликованного приложения (с предупреждением и
 * отдельными разрешениями), Академия (интерактивные уроки), документация API,
 * домашняя страница Студии (проекты, опубликованные, проверенные приложения).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, BookOpen, Camera, Check, Mic, Monitor, MonitorDown, Play, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { confirm } from '../../shared/ui/Modal';
import { createItem, useDeskItems } from '../desktop/cloud';
import { openMaximized, openPath } from '../desktop/fx';
import { API, lint, PERMISSION_INFO } from './model';
import { LESSONS } from './lessons';
import './studio.css';

interface AppMeta {
  slug: string;
  name: string;
  version: number;
  review: 'none' | 'pending' | 'verified' | 'rejected';
  permissions: string[];
  owner: { username: string; displayName: string; verified: boolean } | null;
  updatedAt: string;
}

const PERM_ICON: Record<string, React.ReactNode> = { camera: <Camera size={15} />, microphone: <Mic size={15} />, screen: <Monitor size={15} /> };
/** Разрешения, которые передаются в iframe через allow (только выданные). */
const ALLOW: Record<string, string> = { camera: 'camera', microphone: 'microphone', screen: 'display-capture' };

export function useAppGrants(slug: string | undefined) {
  return useQuery({ queryKey: ['studio-app', slug], queryFn: () => api.get<{ app: AppMeta; granted: string[] }>(`/studio/apps/${slug}`), enabled: !!slug, retry: false });
}

export function AppRunPage() {
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const q = useAppGrants(slug);
  const [accepted, setAccepted] = useState(false);
  const [running, setRunning] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const granted = q.data?.granted ?? [];
  const app = q.data?.app;
  const verified = app?.review === 'verified';

  const setGrant = async (permission: string, grant: boolean) => {
    try {
      await api.post(`/studio/apps/${slug}/grants`, { permission, grant });
      await qc.invalidateQueries({ queryKey: ['studio-app', slug] });
      void qc.invalidateQueries({ queryKey: ['studio-grants'] });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  // Просьбы приложения: уведомление — только при выданном разрешении; новое разрешение — отдельный вопрос
  useEffect(() => {
    const on = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { __sunnet?: number; type?: string; text?: string; permission?: string };
      if (!d?.__sunnet || !app) return;
      if (d.type === 'notify') {
        if (granted.includes('notifications')) toast(`${app.name}: ${String(d.text ?? '').slice(0, 300)}`);
      } else if (d.type === 'request' && d.permission && app.permissions.includes(d.permission) && !granted.includes(d.permission)) {
        const info = PERMISSION_INFO[d.permission];
        const ok = await confirm({ title: `«${app.name}» просит: ${info?.label ?? d.permission}`, text: `${info?.text ?? ''}. Отозвать можно в любой момент на этой странице или в разделе «Безопасность».`, confirmLabel: 'Разрешить' });
        if (ok) await setGrant(d.permission, true);
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
    // setGrant стабилен по смыслу; пересоздаём подписку при смене разрешений
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, granted.join(',')]);

  if (q.isError) return <div className="st-app st-app--empty">Приложение не найдено или ссылка неверна.</div>;
  if (!app) return <div className="st-app st-app--empty">Загружаем…</div>;
  const allow = granted.map((g) => ALLOW[g]).filter(Boolean).join('; ');

  return (
    <div className="scroll st-app">
      <header className="st-app__head">
        <span className="st-app__icon" aria-hidden>
          {app.name.slice(0, 1)}
        </span>
        <div>
          <h1>{app.name}</h1>
          <div className="st-app__meta">
            {app.owner ? `@${app.owner.username}` : 'Автор удалён'} · версия {app.version} ·{' '}
            {verified ? (
              <span className="st-badge st-badge--ok">
                <BadgeCheck size={14} /> Проверено Sunnet
              </span>
            ) : (
              <span className="st-badge st-badge--warn">
                <AlertTriangle size={14} /> Не проверено
              </span>
            )}
          </div>
        </div>
        <div className="st-app__actions">
          <button
            type="button"
            className="sst__ghost"
            onClick={async () => {
              if (await createItem({ kind: 'link', name: app.name, url: `/app/${app.slug}` })) toast({ text: `${app.name} — на рабочем столе`, kind: 'success' });
            }}
          >
            <MonitorDown size={16} /> На рабочий стол
          </button>
        </div>
      </header>

      {!verified && !accepted && !running && (
        <div className="st-warn" role="alert">
          <AlertTriangle size={20} />
          <div>
            <b>Код этого приложения не проверялся.</b> Открывайте, только если доверяете автору. Оно запустится в изолированной песочнице: без доступа к вашим файлам, чатам, аккаунту и интернету. Ниже — какие разрешения оно может попросить; ни одно не выдаётся без вашего отдельного согласия.
            <label className="st-check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> <span>Я понимаю риски</span>
            </label>
          </div>
        </div>
      )}

      <section className="st-perms">
        <h2>
          <ShieldCheck size={17} /> Разрешения
        </h2>
        {app.permissions.length === 0 && <p className="st-hint">Приложению не нужны разрешения.</p>}
        {app.permissions.map((p) => {
          const on = granted.includes(p);
          return (
            <div key={p} className={`st-perm${on ? ' is-on' : ''}`}>
              <span className={`st-perm__icon${on ? '' : ' is-off'}`}>{PERM_ICON[p] ?? <Check size={15} />}</span>
              <span className="st-perm__text">
                <b>{PERMISSION_INFO[p]?.label ?? p}</b>
                <span>{PERMISSION_INFO[p]?.text}</span>
              </span>
              <button type="button" className={`st-switch${on ? ' is-on' : ''}`} role="switch" aria-checked={on} aria-label={PERMISSION_INFO[p]?.label ?? p} onClick={() => void setGrant(p, !on)}>
                <i />
              </button>
            </div>
          );
        })}
      </section>

      {running ? (
        <div className="st-run">
          {granted.some((g) => ALLOW[g]) && (
            <div className="st-run__live">
              <i /> Приложению разрешено: {granted.filter((g) => ALLOW[g]).map((g) => PERMISSION_INFO[g]?.label).join(', ')}
            </div>
          )}
          {/* key: при смене разрешений песочница перезапускается с новым allow */}
          <iframe key={allow} ref={frame} title={app.name} src={`/api/v1/studio/run/${app.slug}`} sandbox="allow-scripts" allow={allow} className="st-frame st-frame--run" />
        </div>
      ) : (
        <button type="button" className="sst__primary sst__primary--lg" disabled={!verified && !accepted} onClick={() => setRunning(true)}>
          <Play size={16} /> Открыть приложение
        </button>
      )}
    </div>
  );
}

// ─── Домашняя страница Студии ───────────────────────────────────────────────

export function StudioHome() {
  const items = useDeskItems().data ?? [];
  const projects = items.filter((i) => i.kind === 'project');
  const mine = useQuery({ queryKey: ['studio-mine'], queryFn: () => api.get<{ items: AppMeta[] }>('/studio/mine') });
  const verified = useQuery({ queryKey: ['studio-verified'], queryFn: () => api.get<{ items: AppMeta[] }>('/studio/verified') });
  return (
    <div className="scroll st-home">
      <header className="st-home__hero">
        <div className="st-home__sun" aria-hidden />
        <h1>Студия</h1>
        <p>Создавайте свои приложения для Sunnet: экраны, кнопки, анимации и скрипты. Без опыта — Академия научит.</p>
        <div className="st-home__cta">
          <button
            type="button"
            className="sst__primary sst__primary--lg"
            onClick={async () => {
              const item = await createItem({ kind: 'project', name: `Проект №${projects.length + 1}` });
              if (item) void openMaximized(`/studio/${item.id}`);
            }}
          >
            <Plus size={16} /> Новый проект
          </button>
          <button type="button" className="sst__ghost sst__ghost--light" onClick={() => void openPath('/studio/academy')}>
            <BookOpen size={16} /> Академия
          </button>
        </div>
      </header>
      <h2 className="st-home__h">Мои проекты</h2>
      {projects.length ? (
        <ul className="st-cards">
          {projects.map((p, i) => (
            <li key={p.id} style={{ '--i': i } as React.CSSProperties}>
              <button type="button" onClick={() => void openMaximized(`/studio/${p.id}`)}>
                <Sparkles size={22} />
                <b>{p.name}</b>
                <span>Изменён {new Date(p.updatedAt).toLocaleDateString('ru')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="st-hint">Проектов пока нет. Создайте первый — он появится на рабочем столе и сохранится в облаке.</p>
      )}
      <h2 className="st-home__h">Опубликованные</h2>
      <AppList items={mine.data?.items ?? []} empty="Вы ещё ничего не публиковали" />
      <h2 className="st-home__h">Проверенные приложения сообщества</h2>
      <AppList items={verified.data?.items ?? []} empty="Пока пусто — станьте первым" />
    </div>
  );
}

function AppList({ items, empty }: { items: AppMeta[]; empty: string }) {
  if (!items.length) return <p className="st-hint">{empty}</p>;
  return (
    <ul className="st-applist">
      {items.map((a) => (
        <li key={a.slug}>
          <button type="button" onClick={() => void openPath(`/app/${a.slug}`)}>
            <span className="st-app__icon st-app__icon--sm">{a.name.slice(0, 1)}</span>
            <span>
              <b>{a.name}</b>
              <span className="st-hint">
                @{a.owner?.username} · v{a.version} · {a.review === 'verified' ? 'проверено' : a.review === 'pending' ? 'на проверке' : a.review === 'rejected' ? 'проверка отклонена' : 'без проверки'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Академия ───────────────────────────────────────────────────────────────

const DONE_KEY = 'sunnet-academy-done';
function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function AcademyPage() {
  const [done, setDone] = useState<string[]>(readDone);
  const [idx, setIdx] = useState(() => Math.min(LESSONS.findIndex((l) => !readDone().includes(l.id)) === -1 ? 0 : LESSONS.findIndex((l) => !readDone().includes(l.id)), LESSONS.length - 1));
  const lesson = LESSONS[idx]!;
  const [code, setCode] = useState(lesson.start);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  useEffect(() => {
    setCode(lesson.start);
    setResult(null);
  }, [lesson]);
  const problems = useMemo(() => lint(code), [code]);

  const check = () => {
    if (problems.some((p) => p.text.startsWith('Ошибка в коде'))) return setResult({ ok: false, lines: problems.map((p) => p.text) });
    const lines = lesson.checks.map((c) => `${c.test(code) ? '✓' : '✗'} ${c.label}`);
    const ok = lesson.checks.every((c) => c.test(code));
    setResult({ ok, lines });
    if (ok && !done.includes(lesson.id)) {
      const next = [...done, lesson.id];
      setDone(next);
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* прогресс не сохранится между сеансами */
      }
    }
  };

  return (
    <div className="st-academy">
      <aside className="st-academy__path">
        <h2>Путь создателя</h2>
        <div className="st-progress">
          <i style={{ width: `${(done.length / LESSONS.length) * 100}%` }} />
        </div>
        <span className="st-hint">
          {done.length} из {LESSONS.length} уроков
        </span>
        <ol>
          {LESSONS.map((l, i) => (
            <li key={l.id}>
              <button type="button" className={`${i === idx ? 'is-on' : ''}${done.includes(l.id) ? ' is-done' : ''}`} onClick={() => setIdx(i)}>
                <span className="st-step">{done.includes(l.id) ? <Check size={13} /> : i + 1}</span>
                {l.title}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="sst__ghost" onClick={() => void openPath('/studio/docs')}>
          <BookOpen size={16} /> Документация API
        </button>
      </aside>
      <main className="st-academy__lesson">
        <span className="st-badge">
          Урок {idx + 1} · {lesson.minutes} мин
        </span>
        <h1>{lesson.title}</h1>
        {lesson.text.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        <div className="st-task">
          <b>Задание.</b> {lesson.task}
        </div>
        <textarea className="st-academy__code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Код урока" rows={Math.max(8, code.split('\n').length + 1)} />
        {problems.length > 0 && <div className="st-hint st-hint--bad">{problems[0]!.text}</div>}
        <div className="st-academy__row">
          <button type="button" className="sst__primary" onClick={check}>
            <Check size={16} /> Проверить
          </button>
          <button type="button" className="sst__ghost" onClick={() => setCode(lesson.answer)}>
            Показать решение
          </button>
          {result?.ok && idx < LESSONS.length - 1 && (
            <button type="button" className="sst__ghost" onClick={() => setIdx(idx + 1)}>
              Следующий урок →
            </button>
          )}
        </div>
        {result && (
          <ul className={`st-result${result.ok ? ' is-ok' : ''}`}>
            {result.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
            {result.ok && <li className="st-result__win">Отлично! Урок пройден.</li>}
          </ul>
        )}
      </main>
    </div>
  );
}

export function ApiDocsPage() {
  return (
    <div className="scroll st-docs">
      <h1>API Sunnet для приложений</h1>
      <p className="st-hint">SunScript — это обычный JavaScript. Приложение работает в песочнице: без сети и без доступа к данным, пока пользователь не выдаст разрешение.</p>
      {API.map((a) => (
        <article key={a.name} className="st-doc">
          <code className="st-doc__sig">{a.sig}</code>
          <p>{a.text}</p>
          <pre>{a.example}</pre>
        </article>
      ))}
    </div>
  );
}

// ─── Безопасность: разрешения приложений и их история ───────────────────────

interface GrantRow {
  permission: string;
  app: { slug: string; name: string };
  grantedAt: string;
  revokedAt: string | null;
}

export function AppPermissionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['studio-grants'], queryFn: () => api.get<{ items: GrantRow[] }>('/studio/grants') });
  const items = q.data?.items ?? [];
  const active = items.filter((g) => !g.revokedAt);
  const revoke = async (g: GrantRow) => {
    try {
      await api.post(`/studio/apps/${g.app.slug}/grants`, { permission: g.permission, grant: false });
      await qc.invalidateQueries({ queryKey: ['studio-grants'] });
      void qc.invalidateQueries({ queryKey: ['studio-app', g.app.slug] });
      toast(`Разрешение отозвано: ${g.app.name} · ${PERMISSION_INFO[g.permission]?.label ?? g.permission}`);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };
  const when = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="scroll st-docs">
      <h1>Разрешения приложений</h1>
      <p className="st-hint">Камера, микрофон, экран, уведомления и файлы выдаются каждому приложению отдельно. Отозвать можно в любой момент — приложение перезапустится без доступа.</p>
      <h2 className="st-home__h">Сейчас разрешено</h2>
      {active.length === 0 && <p className="st-hint">Ни одному приложению ничего не разрешено.</p>}
      {active.map((g) => (
        <div key={`${g.app.slug}:${g.permission}`} className="st-perm is-on">
          <span className="st-perm__icon">{PERM_ICON[g.permission] ?? <Check size={15} />}</span>
          <span className="st-perm__text">
            <b>
              {g.app.name} · {PERMISSION_INFO[g.permission]?.label ?? g.permission}
            </b>
            <span>с {when(g.grantedAt)}</span>
          </span>
          <button type="button" className="sst__ghost" onClick={() => void revoke(g)}>
            Отозвать
          </button>
        </div>
      ))}
      <h2 className="st-home__h">История</h2>
      <ul className="st-applist">
        {items.map((g, i) => (
          <li key={i} className="st-history">
            <span className={`st-perm__icon${g.revokedAt ? ' is-off' : ''}`}>{PERM_ICON[g.permission] ?? <Check size={15} />}</span>
            <span>
              <b>
                {g.app.name}: {PERMISSION_INFO[g.permission]?.label ?? g.permission}
              </b>
              <span className="st-hint">
                выдано {when(g.grantedAt)}
                {g.revokedAt ? ` · отозвано ${when(g.revokedAt)}` : ' · действует'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
