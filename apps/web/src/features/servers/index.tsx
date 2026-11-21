/**
 * Серверы: мастер создания (где разместить → кто может войти → что нужно →
 * проверка), список и страница управления с живым статусом Sunnet Connect.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Cloud, Copy, Database, Globe, HardDrive, KeyRound, Link2, Lock, Mail, Monitor, Plus, RefreshCw, Server, Trash2, UserCheck, Users } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { confirm } from '../../shared/ui/Modal';
import './servers.css';

type Hosting = 'connect' | 'render' | 'vps';
type Access = 'open' | 'closed' | 'invite' | 'link' | 'request';
interface ServerDto {
  id: string;
  spaceId: string;
  name: string;
  hosting: Hosting;
  access: Access;
  online: boolean;
  lastSeen: string | null;
  device: { host?: string; os?: string; cpuLoad?: number; memFreeMb?: number; memTotalMb?: number; diskFreeGb?: number; latencyMs?: number } | null;
  checks: { id: string; label: string; ok: boolean; help: string }[];
  ready: boolean;
  connectCode?: string;
}

const HOSTING: { id: Hosting; icon: React.ReactNode; title: string; text: string; steps: string[] }[] = [
  {
    id: 'connect',
    icon: <Monitor size={22} />,
    title: 'Мой компьютер',
    text: 'Бесплатно. Через Sunnet Connect — без настройки роутера',
    steps: ['Установите Node.js 22 (nodejs.org → LTS)', 'Скачайте Sunnet Connect и запустите с кодом подключения', 'Не выключайте компьютер и отключите сон, пока сервер работает'],
  },
  {
    id: 'render',
    icon: <Cloud size={22} />,
    title: 'Render',
    text: 'Облако по вашему аккаунту. Бесплатный тариф засыпает после простоя',
    steps: ['render.com → New → Background Worker → папка connect-app', 'Start command: node sunnet-connect.mjs', 'Environment: SUNNET_CONNECT_CODE = код подключения', 'Оплату Render, если нужна, вносите сами'],
  },
  {
    id: 'vps',
    icon: <HardDrive size={22} />,
    title: 'Свой VPS',
    text: 'Selectel, Timeweb, Hetzner и др. — максимум контроля',
    steps: ['Установите Node.js 22 на сервер', 'Скопируйте sunnet-connect.mjs и создайте службу systemd (инструкция в README)', 'Укажите SUNNET_CONNECT_CODE в настройках службы'],
  },
];
const ACCESS: { id: Access; icon: React.ReactNode; title: string; text: string }[] = [
  { id: 'open', icon: <Globe size={18} />, title: 'Открытый', text: 'Найти и войти может любой' },
  { id: 'link', icon: <Link2 size={18} />, title: 'По ссылке', text: 'Входят те, у кого есть ссылка' },
  { id: 'invite', icon: <UserCheck size={18} />, title: 'По приглашению', text: 'Только те, кого вы пригласили' },
  { id: 'request', icon: <Users size={18} />, title: 'По заявке', text: 'Вы одобряете каждого' },
  { id: 'closed', icon: <Lock size={18} />, title: 'Закрытый', text: 'Только вы и назначенные роли' },
];

export function ServersHome() {
  const q = useQuery({ queryKey: ['servers'], queryFn: () => api.get<{ items: ServerDto[] }>('/servers/mine'), refetchInterval: 20_000 });
  const items = q.data?.items ?? [];
  return (
    <div className="scroll srv">
      <header className="srv-hero">
        <div className="srv-hero__orbit" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <h1>Серверы</h1>
        <p>Свои пространства общения: каналы, роли, приглашения. Размещаете там, где удобно вам, — Sunnet ничего не оплачивает за вас и ничего не списывает.</p>
        <Link to="/servers/new" className="srv-btn srv-btn--light">
          <Plus size={16} /> Создать сервер
        </Link>
      </header>
      {items.length === 0 ? (
        <p className="srv-empty">Серверов пока нет. Мастер проведёт по шагам: где разместить, кто может войти и что нужно для запуска.</p>
      ) : (
        <ul className="srv-list">
          {items.map((s, i) => (
            <li key={s.id} style={{ '--i': i } as React.CSSProperties}>
              <Link to={`/servers/${s.id}`}>
                <span className={`srv-dot${s.online ? ' is-on' : ''}`} aria-label={s.online ? 'На связи' : 'Не на связи'} />
                <span className="srv-list__text">
                  <b>{s.name}</b>
                  <span>
                    {HOSTING.find((h) => h.id === s.hosting)?.title} · {ACCESS.find((a) => a.id === s.access)?.title} · {s.ready ? 'готов' : 'нужна настройка'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ServerWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [hosting, setHosting] = useState<Hosting>('connect');
  const [access, setAccess] = useState<Access>('invite');
  const [needs, setNeeds] = useState({ database: true, mail: false, storage: false });
  const [busy, setBusy] = useState(false);
  const steps = ['Название', 'Размещение', 'Доступ', 'Компоненты', 'Проверка'];
  const h = HOSTING.find((x) => x.id === hosting)!;

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<ServerDto>('/servers', { name, hosting, access, needs });
      await qc.invalidateQueries({ queryKey: ['servers'] });
      sessionStorage.setItem(`srv-code:${r.id}`, r.connectCode ?? '');
      navigate(`/servers/${r.id}`);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll srv">
      <Link to="/servers" className="srv-back">
        <ArrowLeft size={16} /> Серверы
      </Link>
      <h1 className="srv-title">Новый сервер</h1>
      <ol className="srv-steps">
        {steps.map((s, i) => (
          <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
            <span>{i < step ? <Check size={13} /> : i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="srv-card" key={step}>
        {step === 0 && (
          <>
            <h2>Как назовём сервер?</h2>
            <input className="srv-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Клуб фотографов" maxLength={60} autoFocus aria-label="Название сервера" />
          </>
        )}
        {step === 1 && (
          <>
            <h2>Где он будет работать</h2>
            <div className="srv-options">
              {HOSTING.map((o) => (
                <button key={o.id} type="button" className={`srv-option${hosting === o.id ? ' is-on' : ''}`} onClick={() => setHosting(o.id)} aria-pressed={hosting === o.id}>
                  <span className="srv-option__icon">{o.icon}</span>
                  <b>{o.title}</b>
                  <span>{o.text}</span>
                </button>
              ))}
            </div>
            <div className="srv-guide">
              <b>Что понадобится</b>
              <ol>
                {h.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Кто может войти</h2>
            <div className="srv-options srv-options--access">
              {ACCESS.map((o) => (
                <button key={o.id} type="button" className={`srv-option${access === o.id ? ' is-on' : ''}`} onClick={() => setAccess(o.id)} aria-pressed={access === o.id}>
                  <span className="srv-option__icon">{o.icon}</span>
                  <b>{o.title}</b>
                  <span>{o.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>Что нужно серверу</h2>
            <p className="srv-hint">Отметьте, чем будете пользоваться — Sunnet заранее проверит, всё ли для этого есть.</p>
            {(
              [
                ['database', <Database size={18} key="d" />, 'База данных', 'Сообщения, роли, участники. Встроенная, ставить ничего не нужно'],
                ['mail', <Mail size={18} key="m" />, 'Приглашения по почте', 'Нужен почтовый сервис: Яндекс 360, Mail.ru или Gmail (SMTP)'],
                ['storage', <HardDrive size={18} key="s" />, 'Файлы и медиа', 'Нужно от 2 ГБ свободного места на устройстве сервера'],
              ] as const
            ).map(([k, icon, title, text]) => (
              <label key={k} className="srv-need">
                <input type="checkbox" checked={needs[k]} onChange={(e) => setNeeds((n) => ({ ...n, [k]: e.target.checked }))} />
                <span className="srv-option__icon">{icon}</span>
                <span>
                  <b>{title}</b>
                  <span className="srv-hint">{text}</span>
                </span>
              </label>
            ))}
          </>
        )}
        {step === 4 && (
          <>
            <h2>Проверим перед созданием</h2>
            <ul className="srv-checks">
              <li className="is-ok">
                <Check size={15} /> Название: «{name}»
              </li>
              <li className="is-ok">
                <Check size={15} /> Размещение: {h.title} — оплачиваете сами, если тариф платный
              </li>
              <li className="is-ok">
                <Check size={15} /> Доступ: {ACCESS.find((a) => a.id === access)?.title}
              </li>
              <li className="is-wait">
                <Server size={15} /> Связь с устройством проверим после создания: появится код для Sunnet Connect
              </li>
              {needs.mail && (
                <li className="is-wait">
                  <Mail size={15} /> Почту для приглашений настроите на странице сервера — до этого приглашения уходят ссылкой
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      <div className="srv-nav">
        {step > 0 && (
          <button type="button" className="srv-btn srv-btn--ghost" onClick={() => setStep(step - 1)}>
            Назад
          </button>
        )}
        {step < 4 ? (
          <button type="button" className="srv-btn" disabled={step === 0 && name.trim().length < 2} onClick={() => setStep(step + 1)}>
            Дальше
          </button>
        ) : (
          <button type="button" className="srv-btn" disabled={busy} onClick={() => void create()}>
            {busy ? 'Создаём…' : 'Создать сервер'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ServerManage() {
  const { serverId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['server', serverId], queryFn: () => api.get<ServerDto>(`/servers/${serverId}`), refetchInterval: 10_000 });
  const [code, setCode] = useState(() => sessionStorage.getItem(`srv-code:${serverId}`) ?? '');
  const [mail, setMail] = useState({ host: '', port: 465, user: '', password: '' });
  const s = q.data;
  if (q.isError) return <div className="srv srv-empty">Сервер не найден.</div>;
  if (!s) return <div className="srv srv-empty">Загружаем…</div>;
  const d = s.device;
  const copy = (t: string) =>
    void navigator.clipboard
      .writeText(t)
      .then(() => toast('Скопировано'))
      .catch(() => toast(t));

  return (
    <div className="scroll srv">
      <Link to="/servers" className="srv-back">
        <ArrowLeft size={16} /> Серверы
      </Link>
      <header className="srv-head">
        <span className={`srv-pulse${s.online ? ' is-on' : ''}`} aria-hidden>
          <Server size={26} />
        </span>
        <div>
          <h1 className="srv-title">{s.name}</h1>
          <span className="srv-hint">{s.online ? `На связи · ${d?.host ?? ''} · ${d?.latencyMs ?? '—'} мс` : s.lastSeen ? `Последний сигнал ${new Date(s.lastSeen).toLocaleString('ru')}` : 'Устройство ещё не подключено'}</span>
        </div>
        <Link to={`/communities/${s.spaceId}`} className="srv-btn">
          Открыть сервер
        </Link>
      </header>

      {d && (
        <div className="srv-res">
          {[
            ['Процессор', `${d.cpuLoad ?? '—'}%`, Math.min(100, d.cpuLoad ?? 0)],
            ['Память', `${d.memFreeMb ?? '—'} МБ`, d.memTotalMb ? 100 - Math.round(((d.memFreeMb ?? 0) / d.memTotalMb) * 100) : 0],
            ['Диск', `${d.diskFreeGb ?? '—'} ГБ`, 0],
          ].map(([k, v, pct]) => (
            <div key={k as string} className="srv-ring">
              <svg viewBox="0 0 80 80" aria-hidden>
                <circle cx="40" cy="40" r="34" className="srv-ring__bg" />
                <circle cx="40" cy="40" r="34" className="srv-ring__fg" style={{ strokeDashoffset: 214 - (214 * Number(pct)) / 100 }} />
              </svg>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
      )}

      <section className="srv-card">
        <h2>Проверка перед запуском</h2>
        <ul className="srv-checks">
          {s.checks.map((c) => (
            <li key={c.id} className={c.ok ? 'is-ok' : 'is-wait'}>
              {c.ok ? <Check size={15} /> : <RefreshCw size={15} />}
              <span>
                <b>{c.label}</b>
                <span className="srv-hint">{c.help}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="srv-card">
        <h2>Подключение устройства</h2>
        <p className="srv-hint">
          Запустите на устройстве: <code>node sunnet-connect.mjs {code || 'КОД'}</code>. Статус — на http://127.0.0.1:7470.
        </p>
        {code ? (
          <div className="srv-code">
            <KeyRound size={16} />
            <code>{code}</code>
            <button type="button" onClick={() => copy(code)}>
              <Copy size={14} /> Скопировать
            </button>
          </div>
        ) : (
          <p className="srv-hint">Код показывается один раз. Потеряли — выпустите новый (старый перестанет работать).</p>
        )}
        <button
          type="button"
          className="srv-btn srv-btn--ghost"
          onClick={async () => {
            const r = await api.post<{ connectCode: string }>(`/servers/${s.id}/code`);
            setCode(r.connectCode);
            sessionStorage.setItem(`srv-code:${s.id}`, r.connectCode);
          }}
        >
          <RefreshCw size={15} /> Новый код
        </button>
      </section>

      {s.checks.some((c) => c.id === 'mail' && !c.ok) && (
        <section className="srv-card">
          <h2>Почта для приглашений</h2>
          <p className="srv-hint">Яндекс 360: smtp.yandex.ru, порт 465, логин — адрес почты, пароль — «пароль приложения» из настроек Яндекс ID.</p>
          <div className="srv-mail">
            <input className="srv-input" placeholder="SMTP-сервер" value={mail.host} onChange={(e) => setMail({ ...mail, host: e.target.value })} aria-label="SMTP-сервер" />
            <input className="srv-input" type="number" placeholder="Порт" value={mail.port} onChange={(e) => setMail({ ...mail, port: Number(e.target.value) })} aria-label="Порт" />
            <input className="srv-input" placeholder="Логин" value={mail.user} onChange={(e) => setMail({ ...mail, user: e.target.value })} aria-label="Логин" />
            <input className="srv-input" type="password" placeholder="Пароль приложения" value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} aria-label="Пароль" />
          </div>
          <button
            type="button"
            className="srv-btn"
            onClick={async () => {
              try {
                await api.put(`/servers/${s.id}/mail`, mail);
                await qc.invalidateQueries({ queryKey: ['server', s.id] });
                toast({ text: 'Почта настроена', kind: 'success' });
              } catch (e) {
                toast({ text: errorMessage(e), kind: 'error' });
              }
            }}
          >
            Сохранить
          </button>
        </section>
      )}

      <button
        type="button"
        className="srv-danger"
        onClick={async () => {
          if (!(await confirm({ title: `Удалить «${s.name}»?`, text: 'Сервер и его настройки будут удалены.', confirmLabel: 'Удалить', danger: true }))) return;
          await api.del(`/servers/${s.id}`);
          await qc.invalidateQueries({ queryKey: ['servers'] });
          navigate('/servers');
        }}
      >
        <Trash2 size={15} /> Удалить сервер
      </button>
    </div>
  );
}
