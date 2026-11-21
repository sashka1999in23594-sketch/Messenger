/**
 * Подключённые мессенджеры в общем списке чатов Sunnet: Telegram и WhatsApp Business.
 * Переписки приходят с сервера (/bridge/*), у каждого чата — значок источника,
 * ответ уходит туда же, откуда пришло сообщение.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, KeyRound, Phone, Send, ShieldCheck, Unplug } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import { confirm } from '../../shared/ui/Modal';
import './bridge.css';

export type Service = 'telegram' | 'whatsapp';
export interface BridgeChat {
  id: string;
  service: Service;
  title: string;
  kind: 'user' | 'group' | 'channel';
  lastText: string;
  lastAt: string | null;
  unread: number;
}
interface BridgeStatus {
  telegram: { available: boolean; connected: boolean; account: string | null };
  whatsapp: { available: boolean; connected: boolean; account: string | null };
}

export const SERVICE_LABEL: Record<Service | 'sunnet', string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', sunnet: 'Sunnet' };

export function useBridgeStatus() {
  return useQuery({ queryKey: ['bridge-status'], queryFn: () => api.get<BridgeStatus>('/bridge/status'), staleTime: 60_000, retry: false });
}

/** Чаты подключённых мессенджеров; обновляются каждые 20 секунд, новые — тостом. */
export function useBridgeChats(enabled: boolean) {
  const prev = useRef<Map<string, number>>(new Map());
  const q = useQuery({
    queryKey: ['bridge-chats'],
    queryFn: () => api.get<{ chats: BridgeChat[]; errors: { service: Service; text: string }[] }>('/bridge/chats'),
    enabled,
    refetchInterval: 20_000,
    retry: false,
  });
  useEffect(() => {
    const chats = q.data?.chats ?? [];
    const before = prev.current;
    if (before.size) {
      for (const c of chats) if (c.unread > (before.get(c.id) ?? 0)) toast({ text: `${SERVICE_LABEL[c.service]} · ${c.title}: ${c.lastText.slice(0, 80)}` });
    }
    prev.current = new Map(chats.map((c) => [c.id, c.unread]));
  }, [q.data]);
  return q;
}

/** Значок источника на аватаре. */
export function SourceBadge({ service }: { service: Service | 'sunnet' }) {
  return <span className={`src-badge src-badge--${service}`} title={SERVICE_LABEL[service]} aria-label={`Из ${SERVICE_LABEL[service]}`} />;
}

const time = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
};

export function BridgeChatItem({ chat, active }: { chat: BridgeChat; active: boolean }) {
  return (
    <Link to={`/chats/x/${encodeURIComponent(chat.id)}`} className={`chat-item bridge-item${active ? ' chat-item--active' : ''}`}>
      <span className="chat-item__avatar bridge-item__avatar">
        <span className={`bridge-ava bridge-ava--${chat.service}`}>{chat.title.slice(0, 1).toUpperCase()}</span>
        <SourceBadge service={chat.service} />
      </span>
      <span className="bridge-item__body">
        <span className="bridge-item__row">
          <b className="bridge-item__title">{chat.title}</b>
          <span className="bridge-item__time">{time(chat.lastAt)}</span>
        </span>
        <span className="bridge-item__row">
          <span className="bridge-item__text">{chat.lastText || 'Нет сообщений'}</span>
          {chat.unread > 0 && <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Переписка из Telegram или WhatsApp внутри Sunnet. */
export function BridgeChatView() {
  const { bridgeId = '' } = useParams();
  const id = decodeURIComponent(bridgeId);
  const qc = useQueryClient();
  const chat = (qc.getQueryData<{ chats: BridgeChat[] }>(['bridge-chats'])?.chats ?? []).find((c) => c.id === id);
  const service: Service = id.startsWith('tg:') ? 'telegram' : 'whatsapp';
  const q = useQuery({
    queryKey: ['bridge-msgs', id],
    queryFn: () => api.get<{ messages: { id: string; text: string; outgoing: boolean; at: string; author: string | null }[] }>(`/bridge/chats/${encodeURIComponent(id)}/messages`),
    refetchInterval: 8000,
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [q.data]);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await api.post(`/bridge/chats/${encodeURIComponent(id)}/messages`, { text: t });
      setText('');
      await q.refetch();
      void qc.invalidateQueries({ queryKey: ['bridge-chats'] });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bridge-view">
      <header className="bridge-view__head">
        <Link to="/chats" className="icon-btn mobile-only" aria-label="Назад">
          <ArrowLeft size={20} />
        </Link>
        <span className="chat-item__avatar bridge-item__avatar">
          <span className={`bridge-ava bridge-ava--${service}`}>{(chat?.title ?? '?').slice(0, 1).toUpperCase()}</span>
          <SourceBadge service={service} />
        </span>
        <span>
          <b>{chat?.title ?? 'Чат'}</b>
          <span className="bridge-view__sub">через {SERVICE_LABEL[service]}</span>
        </span>
      </header>
      <div className="bridge-view__msgs">
        {q.isLoading && <div className="bridge-view__hint">Загружаем переписку…</div>}
        {q.isError && <div className="bridge-view__hint">{errorMessage(q.error)}</div>}
        {(q.data?.messages ?? []).map((m, i) => (
          <div key={m.id} className={`bridge-msg${m.outgoing ? ' bridge-msg--out' : ''}`} style={{ '--i': Math.min(i, 12) } as React.CSSProperties}>
            {!m.outgoing && m.author && chat?.kind !== 'user' && <span className="bridge-msg__author">{m.author}</span>}
            <span className="bridge-msg__text">{m.text}</span>
            <span className="bridge-msg__time">{time(m.at)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="bridge-view__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Сообщение — уйдёт в ${SERVICE_LABEL[service]}`} aria-label="Сообщение" maxLength={4000} />
        <button type="submit" disabled={!text.trim() || busy} aria-label="Отправить">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

/** Подключение мессенджеров: Telegram по номеру, WhatsApp Business по токену из Meta. */
export function BridgeConnectPage() {
  const st = useBridgeStatus();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [waToken, setWaToken] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['bridge-status'] });
    await qc.invalidateQueries({ queryKey: ['bridge-chats'] });
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const tgStep = (r: { status: string; account?: string }) => {
    if (r.status === 'code') setStep('code');
    if (r.status === 'password') setStep('password');
    if (r.status === 'connected') {
      toast({ text: `Telegram подключён: ${r.account}. Чаты появятся в общем списке`, kind: 'success' });
      void done().then(() => navigate('/chats'));
    }
  };
  const disconnect = async (service: Service) => {
    if (!(await confirm({ title: `Отключить ${SERVICE_LABEL[service]}?`, text: 'Переписки исчезнут из Sunnet. В самом мессенджере ничего не удалится.', confirmLabel: 'Отключить', danger: true }))) return;
    await run(async () => {
      await api.del(`/bridge/${service}`);
      await done();
      setStep('phone');
    });
  };

  const s = st.data;
  return (
    <div className="scroll bridge-connect">
      <h1>Подключённые мессенджеры</h1>
      <p className="bridge-connect__lead">Переписки из подключённых сервисов появятся в общем списке чатов Sunnet со значком источника. Ответ уходит туда же, откуда пришло сообщение.</p>

      <section className="bridge-card bridge-card--telegram">
        <header>
          <span className="bridge-ava bridge-ava--telegram">T</span>
          <div>
            <b>Telegram</b>
            <span>{s?.telegram.connected ? `Подключён: ${s.telegram.account}` : 'Вход вашим номером через официальный протокол Telegram'}</span>
          </div>
          {s?.telegram.connected && (
            <button type="button" className="bridge-off" onClick={() => void disconnect('telegram')}>
              <Unplug size={15} /> Отключить
            </button>
          )}
        </header>
        {s && !s.telegram.available && <p className="bridge-note">Подключение Telegram ещё не настроено на сервере: владельцу нужно указать TELEGRAM_API_ID и TELEGRAM_API_HASH (my.telegram.org).</p>}
        {s?.telegram.available && !s.telegram.connected && (
          <form
            className="bridge-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 'phone') void run(async () => tgStep(await api.post('/bridge/telegram/start', { phone: phone.replace(/[\s()-]/g, '') })));
              if (step === 'code') void run(async () => tgStep(await api.post('/bridge/telegram/code', { code })));
              if (step === 'password') void run(async () => tgStep(await api.post('/bridge/telegram/password', { password })));
            }}
          >
            <ol className="bridge-steps">
              <li className={step === 'phone' ? 'is-now' : 'is-done'}>{step === 'phone' ? <Phone size={14} /> : <Check size={14} />} Номер</li>
              <li className={step === 'code' ? 'is-now' : step === 'password' ? 'is-done' : ''}>{step === 'password' ? <Check size={14} /> : '2'} Код из Telegram</li>
              <li className={step === 'password' ? 'is-now' : ''}>
                <KeyRound size={14} /> Облачный пароль
              </li>
            </ol>
            {step === 'phone' && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" inputMode="tel" autoComplete="tel" aria-label="Номер телефона" />}
            {step === 'code' && <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код из приложения Telegram" inputMode="numeric" autoComplete="one-time-code" aria-label="Код" autoFocus />}
            {step === 'password' && <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Облачный пароль Telegram" autoComplete="current-password" aria-label="Облачный пароль" autoFocus />}
            <button type="submit" className="bridge-go" disabled={busy}>
              {busy ? 'Подождите…' : step === 'phone' ? 'Получить код' : 'Продолжить'}
            </button>
            <p className="bridge-note">
              <ShieldCheck size={14} /> Пароль и код не сохраняются. Ключ сеанса хранится зашифрованным; Telegram покажет вход «Sunnet» в списке устройств — оттуда его можно завершить.
            </p>
          </form>
        )}
      </section>

      <section className="bridge-card bridge-card--whatsapp">
        <header>
          <span className="bridge-ava bridge-ava--whatsapp">W</span>
          <div>
            <b>WhatsApp Business</b>
            <span>{s?.whatsapp.connected ? `Подключён: ${s.whatsapp.account}` : 'Официальный Cloud API от Meta'}</span>
          </div>
          {s?.whatsapp.connected && (
            <button type="button" className="bridge-off" onClick={() => void disconnect('whatsapp')}>
              <Unplug size={15} /> Отключить
            </button>
          )}
        </header>
        {!s?.whatsapp.connected && (
          <form
            className="bridge-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await api.post<{ account: string }>('/bridge/whatsapp/connect', { token: waToken.trim(), phoneNumberId: waPhone.trim() });
                toast({ text: `WhatsApp подключён: ${r.account}`, kind: 'success' });
                await done();
              });
            }}
          >
            <p className="bridge-note">
              Личные аккаунты WhatsApp не дают официального доступа к перепискам. Подключается бизнес-номер: Meta for Developers → WhatsApp → API Setup — там «Phone number ID» и постоянный токен.
            </p>
            <input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="Phone number ID" inputMode="numeric" aria-label="Phone number ID" />
            <input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="Токен доступа" type="password" autoComplete="off" aria-label="Токен доступа" />
            <button type="submit" className="bridge-go" disabled={busy || !waToken || !waPhone}>
              {busy ? 'Проверяем…' : 'Подключить'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
