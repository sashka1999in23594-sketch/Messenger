/** Страницы Reels вне ленты: загрузка нового ролика и сетка «Мои Reels». */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ChevronLeft, Clapperboard, Hash, ImageIcon, MessageCircleOff, Play, Plus, Smartphone, Timer } from 'lucide-react';
import type { Post } from '@omni/shared';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useInfiniteScroll, useMediaQuery } from '../../shared/hooks';
import { useMe } from '../../shared/stores/session';
import { compactNumber, duration, plural, views } from '../../shared/lib/format';
import { Avatar, ButtonLink, ErrorState, Spinner } from '../../shared/ui';
import { UploadVideoForm } from '../video/components';

// ─── Загрузка ───────────────────────────────────────────────────────────────

const TIPS = [
  { icon: Smartphone, title: 'Вертикально, 9:16', text: 'Так ролик займёт весь экран телефона.' },
  { icon: Timer, title: 'До 3 минут', text: 'Подойдут файлы MP4, WebM и MOV.' },
  { icon: ImageIcon, title: 'Обложка', text: 'Создаётся автоматически из кадра видео.' },
  { icon: Hash, title: 'Подпись и #хэштеги', text: 'По хэштегам ролик находят в поиске и темах.' },
  { icon: MessageCircleOff, title: 'Комментарии', text: 'Их можно отключить перед публикацией.' },
];

export function CreateShortPage() {
  const navigate = useNavigate();
  return (
    <div className="scroll rl-up">
      <div className="rl-up__glow" aria-hidden />
      <div className="rl-up__wrap">
        <header className="rl-up__head">
          <Link to="/reels" className="rl-up__back">
            <ChevronLeft size={18} /> Reels
          </Link>
          <h1 className="rl-up__title">Новый Reels</h1>
          <p className="rl-up__lead">Выберите вертикальное видео, добавьте подпись и опубликуйте.</p>
        </header>
        <div className="rl-up__grid">
          <section className="rl-up__card" aria-label="Видео и подпись">
            <UploadVideoForm kind="short" onDone={(p) => navigate(`/reels?start=${p.id}`)} />
          </section>
          <aside className="rl-up__tips" aria-labelledby="rl-up-tips">
            <h2 id="rl-up-tips">Перед публикацией</h2>
            <ul>
              {TIPS.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <span className="rl-up__tip-icon">
                    <Icon size={18} />
                  </span>
                  <span className="rl-up__tip-text">
                    <b>{title}</b>
                    <span>{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ─── Мои Reels ──────────────────────────────────────────────────────────────

/** Слово после числа: после «6,5 тыс.» всегда «просмотров». */
const countWord = (n: number, one: string, few: string, many: string) => (n >= 1000 ? many : plural(n, one, few, many));

function ReelThumb({ post, canHover }: { post: Post; canHover: boolean }) {
  const m = post.media[0];
  const [hover, setHover] = useState(false);
  return (
    <Link
      to={`/reels?start=${post.id}&from=mine`}
      className="rl-thumb"
      onPointerEnter={() => canHover && setHover(true)}
      onPointerLeave={() => setHover(false)}
      aria-label={`${post.text.trim() || 'Reels без подписи'} — ${views(post.stats.views)}`}
    >
      {m?.posterUrl ? (
        <img className="rl-thumb__img" src={m.posterUrl} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <span className="rl-thumb__blank">
          <Clapperboard size={26} />
        </span>
      )}
      {/* Наведение мышью — короткий беззвучный предпросмотр */}
      {hover && m && <video className="rl-thumb__video" src={m.url} muted autoPlay loop playsInline preload="auto" aria-hidden />}
      <span className="rl-thumb__shade" aria-hidden />
      {m?.durationSec ? <span className="rl-thumb__dur">{duration(m.durationSec)}</span> : null}
      <span className="rl-thumb__views" aria-hidden>
        <Play size={13} fill="currentColor" strokeWidth={0} />
        {compactNumber(post.stats.views)}
      </span>
    </Link>
  );
}

export function MyShortsPage() {
  const me = useMe();
  const list = useCursorList<Post>(qk.userPosts(me.id, 'short'), `/users/${me.id}/posts?tab=short`);
  const items = flatPages(list.data);
  const more = !!list.hasNextPage;
  const sentinel = useInfiniteScroll(() => void list.fetchNextPage(), more && !list.isFetchingNextPage);
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const totals = items.reduce((a, p) => ({ views: a.views + p.stats.views, likes: a.likes + p.stats.likes }), { views: 0, likes: 0 });
  const plus = more ? '+' : '';

  return (
    <div className="scroll rl-mine">
      <div className="rl-mine__wrap">
        <header className="rl-mine__head">
          <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={64} />
          <div className="rl-mine__who">
            <h1>{me.displayName}</h1>
            <span className="rl-mine__user">@{me.username} · Мои Reels</span>
          </div>
          <ButtonLink to="/reels/new" size="sm" pill icon={<Plus size={16} />}>
            Загрузить
          </ButtonLink>
        </header>

        {!list.isLoading && !list.isError && items.length > 0 && (
          <dl className="rl-mine__stats">
            <div>
              <dt>{plural(items.length, 'ролик', 'ролика', 'роликов')}</dt>
              <dd>
                {items.length}
                {plus}
              </dd>
            </div>
            <div>
              <dt>{countWord(totals.views, 'просмотр', 'просмотра', 'просмотров')}</dt>
              <dd>
                {compactNumber(totals.views)}
                {plus}
              </dd>
            </div>
            <div>
              <dt>{countWord(totals.likes, 'лайк', 'лайка', 'лайков')}</dt>
              <dd>
                {compactNumber(totals.likes)}
                {plus}
              </dd>
            </div>
          </dl>
        )}

        {list.isLoading ? (
          <div className="rl-grid" aria-busy="true" aria-label="Загрузка">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="rl-thumb rl-thumb--skeleton" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <div className="rl-mine__empty">
            <span className="rl-mine__empty-icon">
              <Clapperboard size={30} />
            </span>
            <h2>У вас пока нет Reels</h2>
            <p>Загрузите вертикальное видео — оно появится здесь и в ленте «Для вас».</p>
            <ButtonLink to="/reels/new" pill icon={<Plus size={18} />}>
              Загрузить Reels
            </ButtonLink>
          </div>
        ) : (
          <div className="rl-grid">
            <Link to="/reels/new" className="rl-thumb rl-thumb--new" aria-label="Загрузить новый Reels">
              <span className="rl-thumb__plus">
                <Plus size={26} strokeWidth={2.6} />
              </span>
              <span>Новый</span>
            </Link>
            {items.map((p) => (
              <ReelThumb key={p.id} post={p} canHover={canHover} />
            ))}
          </div>
        )}
        <div ref={sentinel} />
        {list.isFetchingNextPage && (
          <div className="rl-mine__more">
            <Spinner />
          </div>
        )}
      </div>
    </div>
  );
}
