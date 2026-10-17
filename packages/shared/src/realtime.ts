/**
 * Протокол WebSocket (/api/v1/ws). Сервер присылает события, клиент — только
 * лёгкие сигналы (набор текста, пинг). Все изменения данных идут через REST,
 * поэтому протокол легко масштабировать (Redis pub/sub, NATS) без изменения клиента.
 */
import type { AppNotification, CallInfo, Counters, ID, Message } from './types.js';

/** Что делает собеседник: печатает, записывает голосовое или кружок. */
export type ChatActivity = 'typing' | 'voice' | 'round';

/** Сигнализация WebRTC: описание сеанса или ICE-кандидат. */
export type CallSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: 'media'; audio: boolean; video: boolean };

export type ServerEvent =
  | { t: 'hello'; userId: ID; serverTime: string }
  | { t: 'message.new'; chatId: ID; message: Message }
  | { t: 'message.updated'; chatId: ID; message: Message }
  | { t: 'message.deleted'; chatId: ID; messageId: ID }
  /** Изменились метаданные чата — клиент перезапрашивает его */
  | { t: 'chat.changed'; chatId: ID }
  /** Вас удалили из чата или чат удалён */
  | { t: 'chat.removed'; chatId: ID }
  /** Изменилась компания или сообщество (состав, роли, чаты) */
  | { t: 'space.changed'; spaceId: ID }
  /** Вас исключили или пространство удалено */
  | { t: 'space.removed'; spaceId: ID }
  | { t: 'typing'; chatId: ID; userId: ID; displayName: string; activity?: ChatActivity }
  | { t: 'read'; chatId: ID; userId: ID; seq: number }
  | { t: 'presence'; userId: ID; online: boolean; lastSeenAt: string | null }
  | { t: 'notification.new'; notification: AppNotification }
  | { t: 'counters'; counters: Counters }
  /** Текущий сеанс завершён с другого устройства — клиент выходит */
  | { t: 'session.revoked' }
  /** Входящий звонок / изменение состояния звонка */
  | { t: 'call.incoming'; call: CallInfo }
  | { t: 'call.updated'; call: CallInfo }
  | { t: 'call.signal'; callId: ID; signal: CallSignal }
  | { t: 'pong' };

export type ClientEvent =
  | { t: 'typing'; chatId: ID; activity?: ChatActivity }
  | { t: 'call.signal'; callId: ID; signal: CallSignal }
  | { t: 'ping' }
  | { t: 'presence.subscribe'; userIds: ID[] };

export const WS_PATH = '/api/v1/ws';
/** Интервал heartbeat — соединение без ответа дольше 2× закрывается */
export const WS_HEARTBEAT_MS = 25_000;
export const TYPING_TTL_MS = 5_000;
