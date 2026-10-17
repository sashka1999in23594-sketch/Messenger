/**
 * Хаб реального времени. Держит WebSocket-соединения в памяти процесса.
 * Интерфейс publish/sendToUser специально минимален: для горизонтального
 * масштабирования его достаточно реализовать поверх Redis Pub/Sub или NATS.
 */
import type { ServerEvent } from '@omni/shared';
import type { WebSocket } from 'ws';

interface Conn {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  alive: boolean;
  /** На чьё присутствие подписано соединение */
  presenceSubs: Set<string>;
}

export type PresenceListener = (userId: string, online: boolean) => void;
/** Закрылось последнее соединение сеанса (вкладка/приложение ушли в офлайн). */
export type SessionGoneListener = (userId: string, sessionId: string) => void;

export class RealtimeHub {
  private readonly byUser = new Map<string, Set<Conn>>();
  private readonly presenceWatchers = new Map<string, Set<Conn>>();
  private readonly presenceListeners: PresenceListener[] = [];
  private readonly sessionGoneListeners: SessionGoneListener[] = [];
  private heartbeat: NodeJS.Timeout | null = null;

  start(intervalMs: number): void {
    this.heartbeat = setInterval(() => {
      for (const conns of this.byUser.values()) {
        for (const c of conns) {
          if (!c.alive) {
            c.socket.terminate();
            continue;
          }
          c.alive = false;
          c.socket.ping();
        }
      }
    }, intervalMs);
    this.heartbeat.unref();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const conns of this.byUser.values()) for (const c of conns) c.socket.close(1001, 'server shutdown');
  }

  onPresence(listener: PresenceListener): void {
    this.presenceListeners.push(listener);
  }

  onSessionGone(listener: SessionGoneListener): void {
    this.sessionGoneListeners.push(listener);
  }

  add(socket: WebSocket, userId: string, sessionId: string): Conn {
    const conn: Conn = { socket, userId, sessionId, alive: true, presenceSubs: new Set() };
    let set = this.byUser.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(conn);
    socket.on('pong', () => {
      conn.alive = true;
    });
    socket.on('close', () => this.remove(conn));
    if (wasOffline) for (const l of this.presenceListeners) l(userId, true);
    return conn;
  }

  private remove(conn: Conn): void {
    const set = this.byUser.get(conn.userId);
    set?.delete(conn);
    if (![...(set ?? [])].some((c) => c.sessionId === conn.sessionId)) {
      for (const l of this.sessionGoneListeners) l(conn.userId, conn.sessionId);
    }
    for (const target of conn.presenceSubs) this.presenceWatchers.get(target)?.delete(conn);
    if (set && set.size === 0) {
      this.byUser.delete(conn.userId);
      for (const l of this.presenceListeners) l(conn.userId, false);
    }
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  watchPresence(conn: Conn, targetIds: string[]): void {
    for (const old of conn.presenceSubs) this.presenceWatchers.get(old)?.delete(conn);
    conn.presenceSubs = new Set(targetIds.slice(0, 200));
    for (const id of conn.presenceSubs) {
      let set = this.presenceWatchers.get(id);
      if (!set) {
        set = new Set();
        this.presenceWatchers.set(id, set);
      }
      set.add(conn);
    }
  }

  /** Получатели событий о присутствии пользователя (userId → набор подписанных пользователей). */
  presenceWatchersOf(userId: string): Map<string, Conn[]> {
    const out = new Map<string, Conn[]>();
    for (const c of this.presenceWatchers.get(userId) ?? []) {
      const list = out.get(c.userId) ?? [];
      list.push(c);
      out.set(c.userId, list);
    }
    return out;
  }

  sendConn(conn: Conn, event: ServerEvent): void {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(event));
  }

  sendToUser(userId: string, event: ServerEvent): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const c of set) if (c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
  }

  sendToUsers(userIds: Iterable<string>, event: ServerEvent, exceptUserId?: string): void {
    const payload = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      if (id === exceptUserId) continue;
      for (const c of this.byUser.get(id) ?? []) if (c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
    }
  }

  /** Событие только в соединения одного сеанса (например, сигнализация звонка — на принявшее устройство). */
  sendToSession(userId: string, sessionId: string, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const c of this.byUser.get(userId) ?? []) if (c.sessionId === sessionId && c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
  }

  sessionOnline(userId: string, sessionId: string): boolean {
    return [...(this.byUser.get(userId) ?? [])].some((c) => c.sessionId === sessionId);
  }

  /** Закрывает соединения отозванного сеанса. */
  kickSession(userId: string, sessionId: string): void {
    for (const c of this.byUser.get(userId) ?? []) {
      if (c.sessionId === sessionId) {
        this.sendConn(c, { t: 'session.revoked' });
        c.socket.close(4001, 'session revoked');
      }
    }
  }

  get connectionCount(): number {
    let n = 0;
    for (const s of this.byUser.values()) n += s.size;
    return n;
  }
}

export type { Conn };
