/**
 * Окно Sunnet отвечает приложению из песочницы. Приложение присылает просьбу
 * (`call`: хранилище, профиль, интернет, оплата), здесь проверяются разрешения,
 * при необходимости спрашивается пользователь, и ответ уходит обратно в iframe.
 * Сообщения принимаются только от «своего» iframe (проверка e.source).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import { CreditCard, Loader2, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../../shared/api/client';
import { useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { confirm } from '../../shared/ui/Modal';
import { SunBurst } from '../../shared/ui/SunBurst';
import { PERMISSION_INFO } from './model';
import './pay.css';

interface Options {
  frame: RefObject<HTMLIFrameElement | null>;
  appName: string;
  /** Опубликованное приложение (запуск) — или проект в редакторе (предпросмотр) */
  slug?: string;
  projectId?: string;
  permissions: string[];
  granted: string[];
  onGrant?: (permission: string) => Promise<void>;
  onLog?: (line: string) => void;
}

export function useAppBridge(o: Options) {
  const ref = useRef(o);
  ref.current = o;
  const memory = useRef(new Map<string, unknown>()); // хранилище предпросмотра — только в памяти

  useEffect(() => {
    const on = async (e: MessageEvent) => {
      const cur = ref.current;
      const win = cur.frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      const d = e.data as { __sunnet?: number; type?: string; id?: number; method?: string; args?: unknown; text?: string; permission?: string };
      if (!d?.__sunnet) return;
      if (d.type === 'error') return cur.onLog?.(`Ошибка: ${String(d.text).slice(0, 200)}`);
      if (d.type === 'log') return cur.onLog?.(String(d.text).slice(0, 500));
      if (d.type !== 'call' || typeof d.id !== 'number') return;
      const reply = (ok: boolean, data?: unknown, error?: string) => win.postMessage({ __sunnetReply: 1, id: d.id, ok, data, error }, '*');
      try {
        reply(true, await handle(cur, String(d.method), d.args, memory.current));
      } catch (err) {
        reply(false, undefined, err instanceof Error ? err.message : errorMessage(err));
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
}

/** Есть ли разрешение; если приложение его заявило — спрашиваем пользователя. */
async function ensure(o: Options, permission: string): Promise<boolean> {
  if (!o.slug) return true; // в редакторе автор проверяет своё приложение
  if (o.granted.includes(permission)) return true;
  if (!o.permissions.includes(permission)) return false;
  const info = PERMISSION_INFO[permission];
  const ok = await confirm({ title: `«${o.appName}» просит: ${info?.label ?? permission}`, text: `${info?.text ?? ''}. Отозвать можно в любой момент в разделе «Безопасность».`, confirmLabel: 'Разрешить' });
  if (ok) await o.onGrant?.(permission);
  return ok;
}

async function handle(o: Options, method: string, args: unknown, memory: Map<string, unknown>): Promise<unknown> {
  const kv = o.slug ? `/studio/apps/${encodeURIComponent(o.slug)}/kv` : null;
  switch (method) {
    case 'request':
      return ensure(o, String(args));
    case 'user': {
      if (!(await ensure(o, 'profile'))) throw new Error('Пользователь не дал доступ к профилю');
      const me = useSession.getState().me;
      return me ? { name: me.displayName, username: me.username } : null;
    }
    case 'storage.get':
      return kv ? (await api.get<{ value: unknown }>(`${kv}/${encodeURIComponent(String(args))}`)).value : (memory.get(String(args)) ?? null);
    case 'storage.set': {
      const { key, value } = args as { key: string; value: string };
      if (kv) await api.put(`${kv}/${encodeURIComponent(key)}`, { value });
      else memory.set(key, JSON.parse(value) as unknown);
      return true;
    }
    case 'storage.remove':
      if (kv) await api.del(`${kv}/${encodeURIComponent(String(args))}`);
      else memory.delete(String(args));
      return true;
    case 'storage.keys':
      return kv ? (await api.get<{ keys: string[] }>(kv)).keys : [...memory.keys()];
    case 'fetch':
      if (!(await ensure(o, 'internet'))) throw new Error('Пользователь не дал доступ в интернет');
      return api.post('/studio/net', { url: String(args), slug: o.slug, projectId: o.slug ? undefined : o.projectId });
    case 'pay': {
      const p = args as { amount: number; description: string; method: 'sbp' | 'card' };
      if (!(p.amount >= 1 && p.amount <= 100_000)) throw new Error('Сумма — от 1 до 100 000 ₽');
      if (o.slug && !o.permissions.includes('payments')) throw new Error('Приложение не заявило приём платежей');
      return openPaySheet({ appName: o.appName, slug: o.slug, ...p });
    }
    default:
      throw new Error(`Нет такой функции: ${method}`);
  }
}

// ─── Окно оплаты: рисует Sunnet, не приложение ───────────────────────────────

type PayResult = { status: 'succeeded' | 'canceled' | 'pending'; id: string | null };

export function openPaySheet(p: { appName: string; slug?: string; amount: number; description: string; method: 'sbp' | 'card' }): Promise<PayResult> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (r: PayResult) => {
      root.unmount();
      host.remove();
      resolve(r);
    };
    root.render(<PaySheet {...p} onDone={done} />);
  });
}

const rub = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;

function PaySheet({ appName, slug, amount, description, method: initial, onDone }: { appName: string; slug?: string; amount: number; description: string; method: 'sbp' | 'card'; onDone: (r: PayResult) => void }) {
  const [method, setMethod] = useState(initial);
  const [step, setStep] = useState<'choose' | 'wait' | 'test' | 'ok' | 'fail'>('choose');
  const [payId, setPayId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const stopped = useRef(false);
  useEffect(() => () => void (stopped.current = true), []);

  const finish = (status: PayResult['status']) => {
    setStep(status === 'succeeded' ? 'ok' : 'fail');
    setTimeout(() => onDone({ status, id: payId }), status === 'succeeded' ? 1500 : 900);
  };

  const pay = async () => {
    setStep('wait');
    setError('');
    if (!slug) {
      setStep('test'); // предпросмотр в редакторе — всегда тестовая оплата
      return;
    }
    try {
      const r = await api.post<{ id: string; test: boolean; confirmationUrl: string | null }>('/studio/pay', { slug, amount, description, method });
      setPayId(r.id);
      if (r.test) return setStep('test');
      if (r.confirmationUrl) window.open(r.confirmationUrl, '_blank', 'noopener,noreferrer');
      // Ждём подтверждения: статус спрашиваем у сервера, он — у платёжного сервиса
      for (let i = 0; i < 300 && !stopped.current; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const s = await api.get<{ status: PayResult['status'] }>(`/studio/payments/${r.id}`).catch(() => ({ status: 'pending' as const }));
        if (s.status !== 'pending') return finish(s.status);
      }
    } catch (e) {
      setError(errorMessage(e));
      setStep('choose');
    }
  };

  const testAnswer = async (ok: boolean) => {
    if (payId) await api.post(`/studio/payments/${payId}/test`, { ok }).catch(() => undefined);
    finish(ok ? 'succeeded' : 'canceled');
  };

  return (
    <div className="pay-overlay" role="dialog" aria-modal="true" aria-label={`Оплата в «${appName}»`}>
      <div className={`pay-card pay-card--${step}`}>
        {step !== 'ok' && step !== 'fail' && (
          <button type="button" className="pay-close" aria-label="Отменить" onClick={() => onDone({ status: 'canceled', id: payId })}>
            <X size={18} />
          </button>
        )}
        <div className="pay-sun">
          <SunBurst size={56} spin />
        </div>
        <div className="pay-app">{appName}</div>
        <div className="pay-amount">{rub(amount)}</div>
        <div className="pay-desc">{description}</div>

        {step === 'choose' && (
          <>
            <div className="pay-methods" role="radiogroup" aria-label="Способ оплаты">
              <button type="button" role="radio" aria-checked={method === 'sbp'} className={method === 'sbp' ? 'is-on' : ''} onClick={() => setMethod('sbp')}>
                <span className="pay-methods__ico pay-methods__ico--sbp">
                  <Smartphone size={20} />
                </span>
                СБП
              </button>
              <button type="button" role="radio" aria-checked={method === 'card'} className={method === 'card' ? 'is-on' : ''} onClick={() => setMethod('card')}>
                <span className="pay-methods__ico pay-methods__ico--card">
                  <CreditCard size={20} />
                </span>
                Карта
              </button>
            </div>
            {error && <div className="pay-error">{error}</div>}
            <button type="button" className="pay-go" onClick={() => void pay()}>
              Оплатить {rub(amount)}
            </button>
            <div className="pay-safe">
              <ShieldCheck size={14} /> Окно оплаты — от Sunnet. Данные карты приложение не видит
            </div>
          </>
        )}
        {step === 'wait' && (
          <div className="pay-wait">
            <Loader2 size={26} className="pay-spin" />
            {method === 'sbp' ? 'Подтвердите оплату в приложении банка' : 'Введите данные карты на странице оплаты'}
          </div>
        )}
        {step === 'test' && (
          <div className="pay-test">
            <b>Тестовая оплата</b>
            <span>Платёжный сервис ещё не подключён — деньги не спишутся.</span>
            <div className="pay-test__row">
              <button type="button" className="pay-go" onClick={() => void testAnswer(true)}>
                Оплатить (тест)
              </button>
              <button type="button" className="pay-ghost" onClick={() => void testAnswer(false)}>
                Отказаться
              </button>
            </div>
          </div>
        )}
        {step === 'ok' && (
          <div className="pay-result">
            <svg viewBox="0 0 52 52" className="pay-check" aria-hidden>
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27l7 7 15-16" />
            </svg>
            Оплачено
          </div>
        )}
        {step === 'fail' && <div className="pay-result pay-result--fail">Оплата отменена</div>}
      </div>
    </div>
  );
}

/** Подсказка для автора: что вернул вызов (используется в журнале предпросмотра). */
export const notifyFromApp = (appName: string, text: string) => toast(`${appName}: ${text}`);
