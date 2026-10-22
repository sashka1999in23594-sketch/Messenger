/**
 * Протокол WebSocket (/api/v1/ws). Сервер присылает события, клиент — только
 * лёгкие сигналы (набор текста, пинг). Все изменения данных идут через REST,
 * поэтому протокол легко масштабировать (Redis pub/sub, NATS) без изменения клиента.
 */
import type { AppNotification, CallInfo, CallRoom, Counters, ID, LiveChatMessage, LiveStream, Message, UserSummary } from './types.js';

/** Что делает собеседник: печатает, записывает голосовое или кружок. */
export type ChatActivity = 'typing' | 'voice' | 'round';

/** Сигнализация WebRTC: описание сеанса или ICE-кандидат. */
export type CallSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: 'media'; audio: boolean; video: boolean };

/**
 * Сигнализация группового звонка: то же, что у звонка 1:1, плюс состояние
 * участника — включены ли микрофон и камера, какой поток — демонстрация экрана,
 * поднята ли рука.
 */
export type RoomSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  | { type: 'media'; audio: boolean; video: boolean; screen: string | null; hand: boolean };

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
  /** Приглашение в групповой звонок */
  | { t: 'room.invite'; room: CallRoom; from: UserSummary }
  /** Изменился состав или состояние группового звонка */
  | { t: 'room.updated'; room: CallRoom }
  /** Сигнал WebRTC от участника группового звонка */
  | { t: 'room.signal'; roomId: ID; from: ID; signal: RoomSignal }
  /** Сообщение в чате звонка */
  | { t: 'room.chat'; roomId: ID; message: LiveChatMessage }
  /** Прямой эфир: зритель подключился или ушёл (ведущему) */
  | { t: 'live.viewer'; streamId: ID; peer: string; joined: boolean }
  /** Сигнал WebRTC эфира: ведущему — от зрителя peer, зрителю — от ведущего */
  | { t: 'live.signal'; streamId: ID; peer: string; signal: CallSignal }
  /** Изменился эфир (зрители, завершён) */
  | { t: 'live.updated'; stream: LiveStream }
  /** Сообщение в чате эфира или премьеры */
  | { t: 'live.chat'; room: string; message: LiveChatMessage }
  | { t: 'pong' };

export type ClientEvent =
  | { t: 'typing'; chatId: ID; activity?: ChatActivity }
  | { t: 'call.signal'; callId: ID; signal: CallSignal }
  | { t: 'live.signal'; streamId: ID; peer: string; signal: CallSignal }
  | { t: 'room.signal'; roomId: ID; to: ID; signal: RoomSignal }
  | { t: 'ping' }
  | { t: 'presence.subscribe'; userIds: ID[] };

export const WS_PATH = '/api/v1/ws';
/** Интервал heartbeat — соединение без ответа дольше 2× закрывается */
export const WS_HEARTBEAT_MS = 25_000;
export const TYPING_TTL_MS = 5_000;
