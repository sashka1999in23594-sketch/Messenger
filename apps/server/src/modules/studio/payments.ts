/**
 * Платежи в приложениях Студии: СБП и банковские карты через ЮKassa.
 *
 * Как это защищено:
 *  • приложение только ПРОСИТ оплату (сумма и назначение); окно оплаты рисует Sunnet,
 *    а не приложение — подделать его из песочницы нельзя;
 *  • данные карты Sunnet не видит и не хранит: оплата проходит на странице ЮKassa / в банке по СБП;
 *  • статус берётся только у самой ЮKassa (запрос по API), а не из уведомления на слово;
 *  • оплатить можно только в приложении, которое при публикации заявило разрешение «Платежи».
 *
 * Без ключей ЮKassa (YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY) работает тестовый режим:
 * платёж подтверждается кнопкой в окне Sunnet, деньги не списываются.
 */
import type { Config } from '../../config.js';

export type Method = 'sbp' | 'card';
export interface ProviderPayment {
  providerId: string;
  status: 'pending' | 'succeeded' | 'canceled';
  confirmationUrl: string | null;
}

const API = 'https://api.yookassa.ru/v3/payments';

const auth = (c: NonNullable<Config['yookassa']>) => `Basic ${Buffer.from(`${c.shopId}:${c.secret}`).toString('base64')}`;
const mapStatus = (s: string): ProviderPayment['status'] => (s === 'succeeded' ? 'succeeded' : s === 'canceled' ? 'canceled' : 'pending');

export async function createProviderPayment(
  config: Config,
  p: { id: string; amountKop: number; description: string; method: Method; returnUrl: string },
): Promise<ProviderPayment> {
  const c = config.yookassa!;
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: auth(c), 'Idempotence-Key': p.id, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: { value: (p.amountKop / 100).toFixed(2), currency: 'RUB' },
      capture: true,
      description: p.description.slice(0, 128),
      payment_method_data: { type: p.method === 'sbp' ? 'sbp' : 'bank_card' },
      confirmation: { type: 'redirect', return_url: p.returnUrl },
      metadata: { sunnet_payment: p.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; status?: string; confirmation?: { confirmation_url?: string }; description?: string } | null;
  if (!res.ok || !body?.id) throw new Error(body?.description || `Платёжный сервис ответил ${res.status}`);
  return { providerId: body.id, status: mapStatus(body.status ?? ''), confirmationUrl: body.confirmation?.confirmation_url ?? null };
}

export async function fetchProviderStatus(config: Config, providerId: string): Promise<ProviderPayment['status']> {
  const c = config.yookassa!;
  const res = await fetch(`${API}/${encodeURIComponent(providerId)}`, { headers: { Authorization: auth(c) }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as { status?: string } | null;
  if (!res.ok) throw new Error(`Платёжный сервис ответил ${res.status}`);
  return mapStatus(body?.status ?? '');
}
