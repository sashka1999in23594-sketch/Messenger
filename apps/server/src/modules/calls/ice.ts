/**
 * Серверы для установки соединения звонка (ICE).
 *
 * STUN помогает устройствам узнать свой внешний адрес — этого хватает, когда
 * оба в «обычных» сетях. Мобильные операторы и корпоративные сети часто
 * прячут абонентов за общим NAT, и прямое соединение невозможно — тогда поток
 * идёт через TURN (в зашифрованном виде: TURN не может его прочитать).
 *
 * Источники TURN по приоритету: Cloudflare (временные учётные данные по ключу),
 * Metered (по ссылке с API-ключом), статические TURN_URLS из окружения.
 */
import type { Config } from '../../config.js';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const TTL_SEC = 24 * 3600;

const hasTurn = (servers: IceServer[]) =>
  servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => u.startsWith('turn:') || u.startsWith('turns:')));

export class IceProvider {
  private cache: { servers: IceServer[]; until: number } | null = null;
  private inflight: Promise<IceServer[] | null> | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: { warn: (obj: object, msg: string) => void },
  ) {}

  /** Какой TURN подключён — для страницы проверки звонков. */
  get source(): 'cloudflare' | 'metered' | 'static' | null {
    if (this.config.turn.cloudflare) return 'cloudflare';
    if (this.config.turn.meteredUrl) return 'metered';
    return hasTurn(this.config.iceServers) ? 'static' : null;
  }

  async get(): Promise<{ iceServers: IceServer[]; relay: boolean }> {
    const base = this.config.iceServers;
    if (!this.config.turn.cloudflare && !this.config.turn.meteredUrl) return { iceServers: base, relay: hasTurn(base) };
    if (this.cache && this.cache.until > Date.now()) return { iceServers: this.cache.servers, relay: true };
    this.inflight ??= this.fetchTurn().finally(() => {
      this.inflight = null;
    });
    const turn = await this.inflight;
    if (!turn?.length) return { iceServers: base, relay: hasTurn(base) };
    const servers = [...base, ...turn];
    // Учётные данные живут сутки — обновляем заранее, за час до истечения
    this.cache = { servers, until: Date.now() + (TTL_SEC - 3600) * 1000 };
    return { iceServers: servers, relay: true };
  }

  private async fetchTurn(): Promise<IceServer[] | null> {
    try {
      const cf = this.config.turn.cloudflare;
      if (cf) {
        const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cf.keyId)}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { authorization: `Bearer ${cf.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: TTL_SEC }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Cloudflare TURN: HTTP ${res.status}`);
        return normalize((await res.json()) as { iceServers?: unknown });
      }
      if (this.config.turn.meteredUrl) {
        const res = await fetch(this.config.turn.meteredUrl, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`Metered TURN: HTTP ${res.status}`);
        return normalize(await res.json());
      }
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'Не удалось получить TURN — звонки только напрямую');
    }
    return null;
  }
}

/** Ответы провайдеров отличаются формой: массив, { iceServers: [...] } или { iceServers: {...} }. */
function normalize(body: unknown): IceServer[] {
  const raw = Array.isArray(body) ? body : (body as { iceServers?: unknown })?.iceServers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((s): s is IceServer => !!s && typeof s === 'object' && 'urls' in s)
    .map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }))
    .filter((s) => hasTurn([s]));
}
