/**
 * Скрытые слова: публикации с ними не попадают в ленты. Слова ищем через FTS5
 * (регистр не важен и для кириллицы), #хэштеги — по таблице тегов.
 */
import type { MutedWord } from '@omni/shared';
import { LIMITS } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso, isoOrNull } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

interface MutedRow {
  id: string;
  user_id: string;
  word: string;
  until: number | null;
  created_at: number;
}

const toDto = (r: MutedRow): MutedWord => ({ id: r.id, word: r.word, until: isoOrNull(r.until), createdAt: iso(r.created_at) });

export class MutedWordsService {
  constructor(private readonly db: Db) {}

  list(userId: string): MutedWord[] {
    return this.db
      .all<MutedRow>('SELECT * FROM muted_words WHERE user_id = :u AND (until IS NULL OR until > :now) ORDER BY created_at DESC', { u: userId, now: Date.now() })
      .map(toDto);
  }

  add(userId: string, input: { word: string; durationHours: number }): MutedWord {
    const word = input.word.trim().toLowerCase();
    if (!word.replace(/^#/, '')) throw badRequest('Пустое слово');
    const n = this.db.value<number>('SELECT COUNT(*) FROM muted_words WHERE user_id = :u', { u: userId }) ?? 0;
    if (n >= LIMITS.mutedWordsMax) throw badRequest(`Не более ${LIMITS.mutedWordsMax} слов`);
    const now = Date.now();
    const until = input.durationHours ? now + input.durationHours * 3600_000 : null;
    this.db.run(
      `INSERT INTO muted_words (id, user_id, word, until, created_at) VALUES (:id, :u, :w, :until, :now)
       ON CONFLICT (user_id, word) DO UPDATE SET until = excluded.until`,
      { id: newId(now), u: userId, w: word, until, now },
    );
    return toDto(this.db.get<MutedRow>('SELECT * FROM muted_words WHERE user_id = :u AND word = :w', { u: userId, w: word })!);
  }

  remove(userId: string, id: string): void {
    if (!this.db.run('DELETE FROM muted_words WHERE id = :id AND user_id = :u', { id, u: userId }).changes) throw notFound('Слово не найдено');
  }
}

/**
 * SQL-условие для ленты (таблица posts p): исключить публикации со скрытыми словами.
 * Возвращает пустую строку, если слов нет. Значения передаются только параметрами.
 */
export function mutedWordsFilter(db: Db, viewerId: string): { sql: string; params: Record<string, unknown> } {
  const words = db
    .all<{ word: string }>('SELECT word FROM muted_words WHERE user_id = :u AND (until IS NULL OR until > :now)', { u: viewerId, now: Date.now() })
    .map((r) => r.word);
  if (!words.length) return { sql: '', params: {} };
  const params: Record<string, unknown> = {};
  const parts: string[] = [];
  const tags = words.filter((w) => w.startsWith('#')).map((w) => w.slice(1));
  const plain = words
    .map((w) => w.replace(/^#/, ''))
    .map((w) => w.replace(/["*^():{}[\]\\]/g, ' ').trim())
    .filter(Boolean);
  if (plain.length) {
    // «слово»* — находит и словоформы с тем же началом (спойлер → спойлеры)
    params.mw_q = plain.map((w) => `"${w}"*`).join(' OR ');
    parts.push('AND p.rowid NOT IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH :mw_q)');
  }
  if (tags.length) {
    const names = tags.map((t, i) => {
      params[`mw_t${i}`] = t;
      return `:mw_t${i}`;
    });
    parts.push(`AND NOT EXISTS (SELECT 1 FROM post_hashtags mh WHERE mh.post_id = p.id AND mh.tag IN (${names.join(', ')}))`);
  }
  return { sql: parts.join(' '), params };
}
