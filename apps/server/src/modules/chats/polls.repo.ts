/**
 * Опросы и викторины в чатах. Голоса хранятся по вариантам; в анонимных опросах
 * наружу отдаются только счётчики, в открытых — ещё и последние проголосовавшие.
 */
import type { Poll, PollInput } from '@omni/shared';
import type { Db } from '../../db/index.js';
import { Db as DbClass, bool } from '../../db/index.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { UsersRepo } from '../users/users.repo.js';

interface PollRow {
  id: string;
  chat_id: string;
  creator_id: string | null;
  question: string;
  multiple: number;
  anonymous: number;
  correct_option_id: string | null;
  closed_at: number | null;
  created_at: number;
}

export class PollsRepo {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepo,
  ) {}

  byId(id: string): PollRow | undefined {
    return this.db.get<PollRow>('SELECT * FROM polls WHERE id = :id', { id });
  }

  create(chatId: string, creatorId: string, input: PollInput): string {
    const now = Date.now();
    const id = newId(now);
    const optionIds = input.options.map(() => newId(now));
    this.db.run(
      `INSERT INTO polls (id, chat_id, creator_id, question, multiple, anonymous, correct_option_id, created_at)
       VALUES (:id, :c, :u, :q, :m, :a, :correct, :now)`,
      {
        id,
        c: chatId,
        u: creatorId,
        q: input.question,
        m: input.multiple,
        a: input.anonymous,
        correct: input.correctOption !== undefined ? optionIds[input.correctOption]! : null,
        now,
      },
    );
    input.options.forEach((text, position) =>
      this.db.run('INSERT INTO poll_options (id, poll_id, position, text) VALUES (:id, :p, :pos, :t)', { id: optionIds[position]!, p: id, pos: position, t: text }),
    );
    return id;
  }

  /** Голос (пустой список — отозвать). В викторине переголосовать нельзя. */
  vote(pollId: string, userId: string, optionIds: string[]): void {
    const poll = this.byId(pollId);
    if (!poll) throw badRequest('Опрос не найден');
    if (poll.closed_at) throw forbidden('Опрос завершён');
    const unique = [...new Set(optionIds)];
    if (!bool(poll.multiple) && unique.length > 1) throw badRequest('В этом опросе можно выбрать только один вариант');
    const valid = new Set(this.db.all<{ id: string }>('SELECT id FROM poll_options WHERE poll_id = :p', { p: pollId }).map((r) => r.id));
    if (unique.some((o) => !valid.has(o))) throw badRequest('Такого варианта нет');
    const voted = !!this.db.get('SELECT 1 FROM poll_votes WHERE poll_id = :p AND user_id = :u', { p: pollId, u: userId });
    if (poll.correct_option_id && voted) throw forbidden('В викторине ответ нельзя изменить');
    this.db.tx(() => {
      this.db.run('DELETE FROM poll_votes WHERE poll_id = :p AND user_id = :u', { p: pollId, u: userId });
      const now = Date.now();
      for (const o of unique) this.db.run('INSERT INTO poll_votes (poll_id, option_id, user_id, created_at) VALUES (:p, :o, :u, :now)', { p: pollId, o, u: userId, now });
    });
  }

  close(pollId: string): void {
    this.db.run('UPDATE polls SET closed_at = coalesce(closed_at, :now) WHERE id = :id', { now: Date.now(), id: pollId });
  }

  dtos(pollIds: readonly string[], viewerId: string): Map<string, Poll> {
    const out = new Map<string, Poll>();
    if (pollIds.length === 0) return out;
    const list = DbClass.inList([...new Set(pollIds)], 'p');
    const polls = this.db.all<PollRow>(`SELECT * FROM polls WHERE id IN (${list.sql})`, list.params);
    const options = this.db.all<{ id: string; poll_id: string; text: string; votes: number; mine: number }>(
      `SELECT o.id, o.poll_id, o.text,
         (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes,
         EXISTS (SELECT 1 FROM poll_votes v WHERE v.option_id = o.id AND v.user_id = :viewer) AS mine
       FROM poll_options o WHERE o.poll_id IN (${list.sql}) ORDER BY o.poll_id, o.position`,
      { ...list.params, viewer: viewerId },
    );
    const voters = this.db.all<{ poll_id: string; n: number }>(
      `SELECT poll_id, COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id IN (${list.sql}) GROUP BY poll_id`,
      list.params,
    );
    const votersBy = new Map(voters.map((v) => [v.poll_id, v.n]));
    for (const p of polls) {
      const opts = options.filter((o) => o.poll_id === p.id);
      const voted = opts.some((o) => o.mine === 1);
      const closed = !!p.closed_at;
      let recentVoters: Poll['recentVoters'] = [];
      if (!bool(p.anonymous)) {
        const ids = this.db
          .all<{ user_id: string }>('SELECT DISTINCT user_id FROM poll_votes WHERE poll_id = :p ORDER BY created_at DESC LIMIT 3', { p: p.id })
          .map((r) => r.user_id);
        const map = this.users.summaries(ids);
        recentVoters = ids.map((id) => map.get(id)).filter((u) => !!u);
      }
      out.set(p.id, {
        id: p.id,
        question: p.question,
        // Пока не проголосовали — результаты скрыты (как в Telegram), чтобы не влиять на выбор
        options: opts.map((o) => ({ id: o.id, text: o.text, votes: voted || closed ? o.votes : 0, mine: o.mine === 1 })),
        totalVoters: votersBy.get(p.id) ?? 0,
        multiple: bool(p.multiple),
        anonymous: bool(p.anonymous),
        quiz: !!p.correct_option_id,
        correctOptionId: voted || closed ? p.correct_option_id : null,
        closed,
        voted,
        recentVoters,
      });
    }
    return out;
  }
}
