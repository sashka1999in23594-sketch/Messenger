/**
 * Черновики и отложенные публикации. Черновик хранится отдельно от постов,
 * поэтому никогда не попадает в ленты; по расписанию фоновая задача
 * публикует его обычным PostsService.create (со всеми проверками).
 */
import type { Post, PostDraft } from '@omni/shared';
import { createPostSchema, LIMITS, type DraftInput } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { iso, isoOrNull } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { MediaService } from '../media/media.service.js';
import type { PostsService } from '../posts/posts.service.js';

interface DraftRow {
  id: string;
  author_id: string;
  payload: string;
  publish_at: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

type Payload = Omit<DraftInput, 'publishAt'>;

export class DraftsService {
  constructor(
    private readonly db: Db,
    private readonly media: MediaService,
    private readonly posts: PostsService,
  ) {}

  private toDto(rows: DraftRow[]): PostDraft[] {
    const payloads = rows.map((r) => JSON.parse(r.payload) as Payload);
    const media = this.media.items(payloads.flatMap((p) => p.mediaIds));
    return rows.map((r, i) => {
      const p = payloads[i]!;
      return {
        id: r.id,
        kind: p.kind,
        title: p.title || null,
        text: p.text,
        media: p.mediaIds.map((m) => media.get(m)).filter((m) => !!m),
        visibility: p.visibility,
        commentsDisabled: p.commentsDisabled,
        publishAt: isoOrNull(r.publish_at),
        error: r.error,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      };
    });
  }

  private own(userId: string, id: string): DraftRow {
    const r = this.db.get<DraftRow>('SELECT * FROM post_drafts WHERE id = :id AND author_id = :u', { id, u: userId });
    if (!r) throw notFound('Черновик не найден');
    return r;
  }

  private publishAt(input: DraftInput): number | null {
    if (!input.publishAt) return null;
    const at = new Date(input.publishAt).getTime();
    if (at < Date.now() + 60_000) throw badRequest('Время публикации должно быть в будущем', { publishAt: 'Выберите время позже текущего' });
    if (at > Date.now() + 365 * 24 * 3600_000) throw badRequest('Не дальше чем на год вперёд', { publishAt: 'Слишком далеко' });
    return at;
  }

  private payload(userId: string, input: DraftInput): string {
    if (input.mediaIds.length) this.media.assertOwned(userId, input.mediaIds);
    const payload: Payload = {
      kind: input.kind,
      text: input.text,
      title: input.title,
      mediaIds: input.mediaIds,
      visibility: input.visibility,
      commentsDisabled: input.commentsDisabled,
    };
    return JSON.stringify(payload);
  }

  /** filter: drafts — черновики, scheduled — запланированные */
  list(userId: string, filter: 'drafts' | 'scheduled'): PostDraft[] {
    const cond = filter === 'scheduled' ? 'publish_at IS NOT NULL ORDER BY publish_at' : 'publish_at IS NULL ORDER BY updated_at DESC';
    return this.toDto(this.db.all<DraftRow>(`SELECT * FROM post_drafts WHERE author_id = :u AND ${cond} LIMIT 200`, { u: userId }));
  }

  create(userId: string, input: DraftInput): PostDraft {
    const n = this.db.value<number>('SELECT COUNT(*) FROM post_drafts WHERE author_id = :u', { u: userId }) ?? 0;
    if (n >= LIMITS.draftsMax) throw badRequest(`Не более ${LIMITS.draftsMax} черновиков — опубликуйте или удалите старые`);
    const publishAt = this.publishAt(input);
    if (publishAt) this.validateForPublish(input);
    const now = Date.now();
    const id = newId(now);
    this.db.run(
      'INSERT INTO post_drafts (id, author_id, payload, publish_at, created_at, updated_at) VALUES (:id, :u, :p, :at, :now, :now)',
      { id, u: userId, p: this.payload(userId, input), at: publishAt, now },
    );
    return this.toDto([this.own(userId, id)])[0]!;
  }

  update(userId: string, id: string, input: DraftInput): PostDraft {
    this.own(userId, id);
    const publishAt = this.publishAt(input);
    if (publishAt) this.validateForPublish(input);
    this.db.run('UPDATE post_drafts SET payload = :p, publish_at = :at, error = NULL, updated_at = :now WHERE id = :id', {
      p: this.payload(userId, input),
      at: publishAt,
      now: Date.now(),
      id,
    });
    return this.toDto([this.own(userId, id)])[0]!;
  }

  remove(userId: string, id: string): void {
    this.own(userId, id);
    this.db.run('DELETE FROM post_drafts WHERE id = :id', { id });
  }

  /** Отложенную публикацию проверяем сразу, чтобы ошибка не всплыла ночью */
  private validateForPublish(input: Payload): void {
    const r = createPostSchema.safeParse(input);
    if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'Публикация заполнена не полностью');
  }

  publish(userId: string, id: string): Post {
    const row = this.own(userId, id);
    const payload = JSON.parse(row.payload) as Payload;
    const r = createPostSchema.safeParse(payload);
    if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'Публикация заполнена не полностью');
    const post = this.posts.create(userId, r.data);
    this.db.run('DELETE FROM post_drafts WHERE id = :id', { id });
    return post;
  }

  /** Фоновая публикация по расписанию; при ошибке черновик остаётся с пометкой */
  publishDue(onError: (err: unknown) => void): number {
    const due = this.db.all<DraftRow>('SELECT * FROM post_drafts WHERE publish_at IS NOT NULL AND publish_at <= :now LIMIT 50', { now: Date.now() });
    let n = 0;
    for (const d of due) {
      try {
        this.publish(d.author_id, d.id);
        n++;
      } catch (err) {
        onError(err);
        const message = err instanceof Error ? err.message : 'Не удалось опубликовать';
        this.db.run('UPDATE post_drafts SET publish_at = NULL, error = :e, updated_at = :now WHERE id = :id', { e: message, now: Date.now(), id: d.id });
      }
    }
    return n;
  }
}
