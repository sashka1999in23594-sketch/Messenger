/**
 * WebSocket-клиент: автоматическое переподключение с экспоненциальной задержкой,
 * heartbeat, восстановление после сна вкладки/смены сети. Обработку событий
 * регистрирует слой приложения (app/realtime.ts).
 */
import { WS_PATH, type ClientEvent, type ServerEvent } from '@omni/shared';
import { useRealtime } from '../stores/realtime';

type Handler = (event: ServerEvent) => void;
type ReconnectHandler = () => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectHandlers = new Set<ReconnectHandler>();
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  private presenceIds: string[] = [];
  private everConnected = false;

  constructor() {
    window.addEventListener('online', () => this.wanted && this.reconnectNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted && (!this.ws || this.ws.readyState > 1)) this.reconnectNow();
    });
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReconnect(handler: ReconnectHandler): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  connect(): void {
    this.wanted = true;
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    useRealtime.getState().setStatus('connecting');
    const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      useRealtime.getState().setStatus('online');
      if (this.presenceIds.length) this.send({ t: 'presence.subscribe', userIds: this.presenceIds });
      if (this.everConnected) this.reconnectHandlers.forEach((h) => h());
      this.everConnected = true;
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (e) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(e.data)) as ServerEvent;
      } catch {
        return;
      }
      this.handlers.forEach((h) => h(event));
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      this.ws = null;
      useRealtime.getState().setStatus('offline');
      // 4001 — сеанс завершён, 4003 — запрещённый источник: переподключаться бессмысленно
      if (!this.wanted || e.code === 4001 || e.code === 4003) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts) + Math.random() * 500;
      this.attempts++;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private reconnectNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.attempts = 0;
    this.connect();
  }

  disconnect(): void {
    this.wanted = false;
    this.everConnected = false;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close(1000);
    this.ws = null;
  }

  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private presenceRefs = new Map<string, number>();

  /** Подписка на присутствие (онлайн/был в сети) с подсчётом ссылок: несколько экранов не мешают друг другу. */
  retainPresence(userIds: string[]): () => void {
    const ids = [...new Set(userIds)];
    for (const id of ids) this.presenceRefs.set(id, (this.presenceRefs.get(id) ?? 0) + 1);
    this.syncPresence();
    return () => {
      for (const id of ids) {
        const n = (this.presenceRefs.get(id) ?? 1) - 1;
        if (n <= 0) this.presenceRefs.delete(id);
        else this.presenceRefs.set(id, n);
      }
      this.syncPresence();
    };
  }

  private syncPresence(): void {
    const next = [...this.presenceRefs.keys()].sort();
    if (next.join() === this.presenceIds.join()) return;
    this.presenceIds = next;
    this.send({ t: 'presence.subscribe', userIds: next });
  }
}

export const realtime = new RealtimeClient();
