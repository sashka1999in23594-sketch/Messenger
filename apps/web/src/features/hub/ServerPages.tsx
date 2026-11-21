/**
 * Свои серверы Sunnet: мастер создания (где размещать, тип доступа, шаблон,
 * проверка компонентов) и Sunnet Connect — помощник, который превращает
 * компьютер пользователя в сервер. Sunnet ничего не оплачивает за человека:
 * инфраструктуру он выбирает и оплачивает сам.
 */
import { useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Cloud, Cpu, Globe, HardDrive, Laptop, Link2, Lock, Mail, Database, Plug, RefreshCw, Server, Users, Wifi, XCircle } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { useCloud } from './cloud';
import './hub.css';

const HOSTS = [
  { id: 'render', icon: Cloud, t: 'Render', s: 'Бесплатный тариф засыпает через 15 мин без запросов — для живого сервера нужен платный Starter' },
  { id: 'vps', icon: Server, t: 'Свой VPS', s: 'Timeweb, Selectel, Hetzner, DigitalOcean — любой Linux-сервер с Docker' },
  { id: 'pc', icon: Laptop, t: 'Мой компьютер', s: 'Через Sunnet Connect — компьютер должен быть включён и в сети' },
  { id: 'other', icon: Globe, t: 'Другая платформа', s: 'Fly.io, Railway, Yandex Cloud — по инструкции Docker' },
];
const ACCESS = [
  { id: 'open', icon: Globe, t: 'Открытый' },
  { id: 'closed', icon: Lock, t: 'Закрытый' },
  { id: 'invite', icon: Users, t: 'По приглашению' },
  { id: 'link', icon: Link2, t: 'По ссылке' },
];
const FEATURES = [
  ['posts', 'Сообщения владельца'],
  ['comments', 'Комментарии'],
  ['reactions', 'Реакции'],
  ['replies', 'Ответы'],
  ['channels', 'Каналы и подгруппы'],
  ['roles', 'Роли'],
  ['invites', 'Приглашения'],
  ['email', 'Рассылка на почту'],
  ['search', 'Поиск по истории'],
] as const;

export function ServerWizard() {
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [host, setHost] = useState('render');
  const [access, setAccess] = useState('invite');
  const [name, setName] = useState('Мой сервер');
  const [feats, setFeats] = useState<Record<string, boolean>>({ posts: true, reactions: true });
  const [addr, setAddr] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [smtp, setSmtp] = useState('');
  const needs = [
    { ok: !!addr, icon: Plug, t: 'Адрес сервера', fix: 'Укажите адрес, который выдал хостинг (например, https://my-server.onrender.com)' },
    { ok: !!dbUrl || !feats.search, icon: Database, t: 'База данных', fix: 'Поиск по истории хранит сообщения в PostgreSQL. Подключите базу (Render PostgreSQL, Supabase, Neon) и вставьте строку подключения' },
    { ok: !!smtp || !feats.email, icon: Mail, t: 'Почтовый сервис', fix: 'Для рассылки нужен SMTP: Яндекс 360, Mail.ru для бизнеса, Resend или SendGrid' },
  ];
  const steps = ['Размещение', 'Доступ', 'Возможности', 'Подключение', 'Проверка'];
  return (
    <div className="hubpage wiz">
      <div className="wiz-steps">
        {steps.map((s, i) => (
          <button key={s} type="button" className={cn('wiz-step', i === step && 'wiz-step--on', i < step && 'wiz-step--done')} onClick={() => setStep(i)}>
            <span>{i < step ? '✓' : i + 1}</span> {s}
          </button>
        ))}
      </div>
      <div className="wiz-body" key={step}>
        {step === 0 && (
          <>
            <h2>Где будет работать «{name}»?</h2>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="wiz-grid">
              {HOSTS.map((h, i) => (
                <button key={h.id} type="button" className={cn('wiz-card', host === h.id && 'wiz-card--on')} style={{ '--i': i } as CSSProperties} onClick={() => setHost(h.id)}>
                  <h.icon size={26} />
                  <b>{h.t}</b>
                  <span>{h.s}</span>
                </button>
              ))}
            </div>
            <p className="hub-muted">Sunnet не оплачивает серверы за вас: вы выбираете и оплачиваете хостинг сами.</p>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Кто сможет войти?</h2>
            <div className="wiz-grid wiz-grid--4">
              {ACCESS.map((a, i) => (
                <button key={a.id} type="button" className={cn('wiz-card', access === a.id && 'wiz-card--on')} style={{ '--i': i } as CSSProperties} onClick={() => setAccess(a.id)}>
                  <a.icon size={24} />
                  <b>{a.t}</b>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>С чего начнём</h2>
            <p className="hub-muted">Базовый шаблон: пишет только владелец. Остальное включается здесь и настраивается в Студии. Серверы — для общения, не для игр.</p>
            <div className="wiz-feats">
              {FEATURES.map(([id, t]) => (
                <label key={id} className={cn('wiz-feat', feats[id] && 'wiz-feat--on')}>
                  <input type="checkbox" checked={!!feats[id]} onChange={(e) => setFeats({ ...feats, [id]: e.target.checked })} /> {t}
                </label>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>Подключение</h2>
            {host === 'render' && (
              <ol className="wiz-howto">
                <li>Зарегистрируйтесь на render.com и нажмите New → Web Service</li>
                <li>Укажите репозиторий с шаблоном сервера Sunnet (Dockerfile) — шаблон появится в Студии в разделе «Серверы»</li>
                <li>Добавьте переменную <code>SUNNET_SERVER_TOKEN</code> — её Sunnet покажет после проверки</li>
                <li>Скопируйте адрес вида <code>https://имя.onrender.com</code> сюда</li>
              </ol>
            )}
            {host === 'pc' && (
              <ol className="wiz-howto">
                <li>Установите Sunnet Connect на компьютер, который будет сервером</li>
                <li>Компьютер должен быть включён и подключён к интернету кабелем или стабильным Wi-Fi</li>
                <li>Sunnet Connect сам откроет туннель — пробрасывать порты на роутере не нужно</li>
                <li>Скопируйте адрес из Sunnet Connect сюда</li>
              </ol>
            )}
            {(host === 'vps' || host === 'other') && (
              <ol className="wiz-howto">
                <li>Установите Docker на сервер</li>
                <li>Соберите и запустите шаблон сервера из Студии: <code>docker compose up -d</code></li>
                <li>Привяжите домен и укажите адрес сюда</li>
              </ol>
            )}
            <label className="field">
              <span className="field__label">Адрес сервера</span>
              <input className="input" placeholder="https://my-server.onrender.com" value={addr} onChange={(e) => setAddr(e.target.value)} />
            </label>
            {feats.search && (
              <label className="field">
                <span className="field__label">База данных (PostgreSQL)</span>
                <input className="input" placeholder="postgres://…" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} />
              </label>
            )}
            {feats.email && (
              <label className="field">
                <span className="field__label">SMTP для писем</span>
                <input className="input" placeholder="smtps://user:pass@smtp.yandex.ru:465" value={smtp} onChange={(e) => setSmtp(e.target.value)} />
              </label>
            )}
          </>
        )}
        {step === 4 && (
          <>
            <h2>Проверка перед запуском</h2>
            {needs.map((n, i) => (
              <div key={n.t} className={cn('wiz-check', n.ok ? 'wiz-check--ok' : 'wiz-check--bad')} style={{ '--i': i } as CSSProperties}>
                {n.ok ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                <div>
                  <b>{n.t}</b>
                  {!n.ok && <div className="hub-muted">{n.fix}</div>}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={needs.some((n) => !n.ok)}
              onClick={() => {
                if (!params.get('id')) useCloud.getState().create('server', name);
              }}
            >
              <Server size={18} /> Запустить сервер
            </button>
          </>
        )}
      </div>
      <div className="wiz-nav">
        <button type="button" className="btn btn--secondary" disabled={!step} onClick={() => setStep(step - 1)}>
          Назад
        </button>
        {step < 4 && (
          <button type="button" className="btn btn--primary" onClick={() => setStep(step + 1)}>
            Дальше
          </button>
        )}
      </div>
    </div>
  );
}

/** Sunnet Connect: в вебе — проверка доступности сервера и инструкция; агент для ПК — в desktop-app. */
export function ConnectPage() {
  const [addr, setAddr] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [ms, setMs] = useState(0);
  const check = async () => {
    setState('checking');
    const t0 = performance.now();
    try {
      const r = await fetch(`${addr.replace(/\/$/, '')}/api/v1/health`, { mode: 'cors', signal: AbortSignal.timeout(20000) });
      setMs(Math.round(performance.now() - t0));
      setState(r.ok ? 'ok' : 'fail');
    } catch {
      setState('fail');
    }
  };
  return (
    <div className="hubpage connect">
      <div className="connect-hero">
        <div className={cn('connect-orb', `connect-orb--${state}`)}>
          <Wifi size={34} />
        </div>
        <div>
          <h1 className="hubpage__title">Sunnet Connect</h1>
          <div className="hub-muted">Ваш компьютер как сервер Sunnet</div>
        </div>
      </div>
      <div className="connect-grid">
        <div className="hubcard">
          <b>Состояние</b>
          <div className="connect-row">{state === 'ok' ? <CheckCircle2 className="orbit-ok" size={18} /> : state === 'fail' ? <XCircle className="orbit-warn" size={18} /> : <RefreshCw size={18} className={state === 'checking' ? 'spin' : ''} />}
            {state === 'ok' ? `Сервер отвечает · ${ms} мс` : state === 'fail' ? 'Нет ответа — сервер выключен, спит или адрес неверный' : state === 'checking' ? 'Проверяем… (спящий Render просыпается до минуты)' : 'Не проверено'}
          </div>
          <input className="input" placeholder="https://my-server.onrender.com" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <button type="button" className="btn btn--primary" disabled={!addr || state === 'checking'} onClick={() => void check()}>
            Проверить соединение
          </button>
        </div>
        <div className="hubcard">
          <b>Ресурсы этого компьютера</b>
          <div className="connect-row"><Cpu size={16} /> Ядер процессора: {navigator.hardwareConcurrency || '—'}</div>
          <div className="connect-row"><HardDrive size={16} /> Память: {(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? '—'} ГБ+</div>
          <div className="connect-row"><Wifi size={16} /> Сеть: {navigator.onLine ? 'онлайн' : 'нет сети'}</div>
        </div>
        <div className="hubcard connect-span">
          <b>Что нужно, чтобы компьютер стал сервером</b>
          <ol className="wiz-howto">
            <li>Скачайте Sunnet для компьютера — Sunnet Connect встроен в него (меню «Сервер»)</li>
            <li>Компьютер не должен уходить в сон: Настройки питания → «Никогда»</li>
            <li>Нужен стабильный интернет от 10 Мбит/с на отдачу</li>
            <li>Порты на роутере открывать не нужно — Connect использует исходящий туннель</li>
            <li>Скопируйте адрес из Connect в мастер создания сервера</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
