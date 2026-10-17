/**
 * Каталог публичных ключей устройств для сквозного шифрования.
 * Сервер хранит ТОЛЬКО публичные ключи; приватные ключи не покидают
 * устройство (неизвлекаемые CryptoKey в IndexedDB браузера).
 */
import type { DeviceKey } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso } from '../../db/index.js';
import { conflict, notFound } from '../../lib/errors.js';
import type { RequestMeta } from '../../http/types.js';
import type { SecurityLog } from '../auth/security-log.js';

interface KeyRow {
  device_id: string;
  user_id: string;
  public_key: string;
  algorithm: 'ECDH-P256';
  created_at: number;
  revoked_at: number | null;
}

const toDto = (r: KeyRow): DeviceKey => ({
  deviceId: r.device_id,
  userId: r.user_id,
  publicKey: r.public_key,
  algorithm: r.algorithm,
  createdAt: iso(r.created_at),
});

export class KeysService {
  constructor(
    private readonly db: Db,
    private readonly log: SecurityLog,
  ) {}

  register(userId: string, input: { deviceId: string; publicKey: string; algorithm: 'ECDH-P256' }, meta: RequestMeta): DeviceKey {
    const existing = this.db.get<KeyRow>('SELECT * FROM device_keys WHERE device_id = :d', { d: input.deviceId });
    if (existing) {
      if (existing.user_id !== userId) throw conflict('Идентификатор устройства уже занят');
      if (existing.public_key !== input.publicKey) {
        throw conflict('Ключ устройства нельзя подменить. Сгенерируйте новое устройство');
      }
      if (existing.revoked_at) {
        this.db.run('UPDATE device_keys SET revoked_at = NULL WHERE device_id = :d', { d: input.deviceId });
      }
      return toDto({ ...existing, revoked_at: null });
    }
    const row: KeyRow = {
      device_id: input.deviceId,
      user_id: userId,
      public_key: input.publicKey,
      algorithm: input.algorithm,
      created_at: Date.now(),
      revoked_at: null,
    };
    this.db.run(
      `INSERT INTO device_keys (device_id, user_id, public_key, algorithm, created_at)
       VALUES (:device_id, :user_id, :public_key, :algorithm, :created_at)`,
      { ...row },
    );
    this.log.record(userId, 'device_key_registered', meta, { deviceId: input.deviceId });
    return toDto(row);
  }

  get(deviceId: string): DeviceKey {
    const row = this.db.get<KeyRow>('SELECT * FROM device_keys WHERE device_id = :d', { d: deviceId });
    if (!row) throw notFound('Ключ устройства не найден');
    return toDto(row);
  }

  listForUser(userId: string): DeviceKey[] {
    return this.db
      .all<KeyRow>('SELECT * FROM device_keys WHERE user_id = :u AND revoked_at IS NULL ORDER BY created_at DESC', { u: userId })
      .map(toDto);
  }

  listOwn(userId: string): DeviceKey[] {
    return this.listForUser(userId);
  }

  latestFor(userId: string): DeviceKey | null {
    return this.listForUser(userId)[0] ?? null;
  }

  revoke(userId: string, deviceId: string): void {
    const r = this.db.run('UPDATE device_keys SET revoked_at = :now WHERE device_id = :d AND user_id = :u AND revoked_at IS NULL', {
      now: Date.now(),
      d: deviceId,
      u: userId,
    });
    if (!r.changes) throw notFound('Ключ устройства не найден');
  }
}
