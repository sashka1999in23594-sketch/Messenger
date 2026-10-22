/**
 * Лента Reels: по одному ролику на экран, перелистывание свайпом, колесом и
 * стрелками, вкладки «Подписки | Для вас | Популярные» с бегущим подчёркиванием.
 * На телефоне и в узком окне — во весь экран; в широком окне — ролик 9:16 по
 * центру и панель действий рядом, как в TikTok на компьютере.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronUp, Clapperboard, LayoutGrid, Plus, RotateCcw, Sparkles, UserPlus, WifiOff } from 'lucide-react';
import type { Post } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { flatPages, qk, useCursorList } from '../../shared/api/query';
import { useIsMobile } from '../../shared/hooks';
import { useMe } from '../../shared/stores/session';
import { cn } from '../../shared/lib/format';
import { useImmersive } from '../../app/layout/Shell';
import { CommentsSheet } from './CommentsSheet';
import { ReelSlide, type SlideControl, type SlideStatus } from './ReelSlide';
import { setMuted, useReducedMotion, useSound, VideoPool } from './lib';

export type FeedMode = 'for-you' | 'following' | 'trending';
type Layout = 'narrow' | 'wide' | 'side';
/** Комментарии: закрыты, шторкой снизу или панелью сбоку */
type SheetMode = 'none' | 'sheet' | 'panel';

const TABS: { mode: FeedMode; label: string; to: string }[] = [
  { mode: 'following', label: 'Подписки', to: '/reels/following' },
  { mode: 'for-you', label: 'Для вас', to: '/reels' },
  { mode: 'trending', label: 'Популярные', to: '/reels/popular' },
];

/** Узко — во весь экран; широко — ролик по центру; очень широко — комментарии сбоку. */
function layoutFor(width: number): Layout {
  if (width >= 1000) return 'side';
  if (width >= 640) return 'wide';
  return 'narrow';
}

export function ShortsFeed({ mode }: { mode: FeedMode }) {
  useImmersive(true);
  const [params] = useSearchParams();
  const from = params.get('from') === 'mine' ? 'mine' : null;
  const start = params.get('start');
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>('narrow');
  const [inWindow, setInWindow] = useState(false);
  const [clean, setClean] = useState(false);
  const [sheet, setSheet] = useState<SheetMode>('none');
  const isMobile = useIsMobile();
  // Пул видео живёт дольше ленты: при смене вкладки звук остаётся разрешённым
  const [pool] = useState(() => new VideoPool(3));
  useEffect(() => () => pool.destroy(), [pool]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setInWindow(!!el.closest('.desk-win'));
    const apply = () => setLayout(layoutFor(el.offsetWidth));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Первое нажатие где угодно в Reels открывает звук всем видео пула (важно для iOS)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const unlock = () => pool.unlock();
    el.addEventListener('touchend', unlock, { capture: true, passive: true });
    el.addEventListener('click', unlock, { capture: true });
    el.addEventListener('keydown', unlock, { capture: true });
    return () => {
      el.removeEventListener('touchend', unlock, { capture: true });
      el.removeEventListener('click', unlock, { capture: true });
      el.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [pool]);

  return (
    <div ref={root} className={cn('rl', `rl--${layout}`, sheet !== 'none' && `rl--${sheet}`, clean && 'rl--clean')} tabIndex={-1}>
      <TopBar mode={mode} mine={from === 'mine'} wide={layout !== 'narrow'} showBack={from === 'mine' || (isMobile && !inWindow)} />
      <Feed key={from ?? mode} mode={mode} from={from} start={start} pool={pool} layout={layout} rootRef={root} onClean={setClean} onSheet={setSheet} />
    </div>
  );
}

// ─── Верхняя панель ─────────────────────────────────────────────────────────

function TopBar({ mode, mine, wide, showBack }: { mode: FeedMode; mine: boolean; wide: boolean; showBack: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const [inkReady, setInkReady] = useState(false);

  // Подчёркивание переезжает под активную вкладку (только transform)
  useLayoutEffect(() => {
    const n = nav.current;
    if (!n) return;
    const place = () => {
      const tab = n.querySelector<HTMLElement>('.rl-tab.is-active');
      if (!tab || !ink.current) return;
      ink.current.style.transform = `translateX(${tab.offsetLeft + tab.offsetWidth / 2 - 11}px)`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(n);
    void document.fonts?.ready.then(place);
    const t = requestAnimationFrame(() => setInkReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(t);
    };
  }, [mode, mine, wide]);

  const back = () => {
    if (mine) return navigate('/reels/mine');
    if (location.key !== 'default') navigate(-1);
    else navigate('/home');
  };

  return (
    <header className="rl-top">
      <div className="rl-top__side">
        {showBack && (
          <button type="button" className="rl-top__btn" onClick={back} aria-label="Назад">
            <ChevronLeft size={24} />
          </button>
        )}
      </div>
      {mine ? (
        <div className="rl-top__title">Мои Reels</div>
      ) : (
        <nav className="rl-tabs" ref={nav} aria-label="Ленты Reels">
          {TABS.map((t) => (
            <Link key={t.mode} to={t.to} replace className={cn('rl-tab', t.mode === mode && 'is-active')} aria-current={t.mode === mode ? 'page' : undefined}>
              {t.label}
            </Link>
          ))}
          <span className={cn('rl-tabs__ink', inkReady && 'is-ready')} ref={ink} aria-hidden />
        </nav>
      )}
      <div className="rl-top__side rl-top__side--end">
        {wide && (
          <Link to="/reels/mine" className="rl-top__btn" aria-label="Мои Reels" title="Мои Reels">
            <LayoutGrid size={20} />
          </Link>
        )}
        <Link to="/reels/new" className={cn('rl-top__btn rl-top__btn--upload', wide && 'is-labeled')} aria-label="Загрузить Reels" title="Загрузить Reels">
          <Plus size={wide ? 18 : 22} strokeWidth={2.6} />
          {wide && <span>Загрузить</span>}
        </Link>
      </div>
    </header>
  );
}

// ─── Лента ──────────────────────────────────────────────────────────────────

interface FeedProps {
  mode: FeedMode;
  from: 'mine' | null;
  start: string | null;
  pool: VideoPool;
  layout: Layout;
  rootRef: RefObject<HTMLDivElement | null>;
  onClean: (on: boolean) => void;
  onSheet: (mode: SheetMode) => void;
}

function Feed({ mode, from, start, pool, layout, rootRef, onClean, onSheet }: FeedProps) {
  const me = useMe();
  const reduced = useReducedMotion();
  const sound = useSound();
  const feed = useCursorList<Post>(qk.feed(mode, 'short'), `/feed/${mode}?kind=short`, { limit: 10, enabled: !from });
  const mineList = useCursorList<Post>(qk.userPosts(me.id, 'short'), `/users/${me.id}/posts?tab=short`, { enabled: from === 'mine' });
  const list = from ? mineList : feed;
  const first = useQuery({ queryKey: qk.post(start ?? ''), queryFn: () => api.get<Post>(`/posts/${start}`), enabled: !!start && !from });
  const items = flatPages(list.data);
  const lead = !from && first.data?.kind === 'short' ? first.data : null;
  const all = lead ? [lead, ...items.filter((p) => p.id !== lead.id)] : items;
  const total = all.length;

  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [visible, setVisible] = useState(true);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const control = useRef<SlideControl | null>(null);

  const go = useCallback(
    (i: number) => {
      const el = scroller.current;
      if (!el) return;
      const target = Math.max(0, Math.min(i, el.children.length - 1));
      el.scrollTo({ top: target * el.clientHeight, behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
    }
  };

  // Открыли «Мои Reels» с конкретного ролика — сразу встаём на него
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (placed.current || !from || !start || !total) return;
    placed.current = true;
    const i = all.findIndex((p) => p.id === start);
    const el = scroller.current;
    if (i > 0 && el) {
      el.scrollTop = i * el.clientHeight;
      activeRef.current = i;
      setActive(i);
    }
  }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Подгрузка заранее, за три ролика до конца
  useEffect(() => {
    if (active >= total - 3 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [active, total, list.hasNextPage, list.isFetchingNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Окно свёрнуто, ушло за край стола или вкладка в фоне — пауза
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let inView = true;
    let shown = !document.hidden;
    const update = () => setVisible(inView && shown);
    const io = new IntersectionObserver(([e]) => {
      inView = !!e?.isIntersecting;
      update();
    }, { threshold: 0.15 });
    io.observe(el);
    const onVis = () => {
      shown = !document.hidden;
      update();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [rootRef]);

  const side = layout === 'side';
  const sheetPost = sheetId ? (side ? all[active] : all.find((p) => p.id === sheetId)) : undefined;
  const sheetOpen = !!sheetPost;
  useEffect(() => onSheet(!sheetOpen ? 'none' : side ? 'panel' : 'sheet'), [sheetOpen, side, onSheet]);
  useEffect(() => {
    if (sheetId && !sheetPost) setSheetId(null);
  }, [sheetId, sheetPost]);
  const openComments = useCallback((id: string) => setSheetId((cur) => (cur === id ? null : id)), []);
  const closeComments = useCallback(() => setSheetId(null), []);

  // Колесо мыши и тачпад: один жест — один ролик
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let lastEvent = 0;
    let lastNav = 0;
    let lastMag = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = performance.now();
      const mag = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
      // Новый жест — после паузы, либо когда сила прокрутки резко выросла (инерция тачпада затухает)
      const fresh = now - lastEvent > 220 || (mag > lastMag * 1.6 && mag > 24);
      lastEvent = now;
      lastMag = mag;
      if (!fresh || now - lastNav < 380 || mag < 4) return;
      lastNav = now;
      go(activeRef.current + Math.sign(e.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // Лента появляется после загрузки — тогда и вешаем обработчик
  }, [go, total > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Клавиатура: ↑/↓ — ролики, пробел — пауза, ←/→ — перемотка, M — звук, L — нравится, C — комментарии
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const host = rootRef.current;
      if (!host || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], .rl-sheet, [role="dialog"], [role="menu"]')) return;
      if (!(host.contains(t) || (t === document.body && isFrontmost(host)))) return;
      const c = control.current;
      switch (e.code) {
        case 'ArrowDown':
        case 'PageDown':
        case 'KeyJ':
          go(activeRef.current + 1);
          break;
        case 'ArrowUp':
        case 'PageUp':
        case 'KeyK':
          go(activeRef.current - 1);
          break;
        case 'Space':
          if (t.closest('button, a, [role="slider"]')) return;
          c?.toggle();
          break;
        case 'ArrowRight':
          c?.seek(5);
          break;
        case 'ArrowLeft':
          c?.seek(-5);
          break;
        case 'KeyM':
          setMuted(!sound.effective);
          break;
        case 'KeyL':
          c?.like();
          break;
        case 'KeyC':
          c?.comments();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, rootRef, sound.effective]);

  if (list.isLoading || (!!start && !from && first.isLoading)) return <FeedSkeleton />;
  if (list.isError && !total)
    return (
      <FeedMessage
        icon={<WifiOff size={30} />}
        title="Не удалось загрузить Reels"
        text={errorMessage(list.error)}
        action={
          <button type="button" className="rl-cta" onClick={() => void list.refetch()}>
            <RotateCcw size={17} /> Повторить
          </button>
        }
      />
    );
  if (!total) return <FeedEmpty mode={from ? 'mine' : mode} />;

  const status = (i: number): SlideStatus => (i === active ? 'active' : i === active + 1 ? 'next' : i === active - 1 ? 'prev' : 'far');
  return (
    <>
      <div className="rl-feed" ref={scroller} onScroll={onScroll} aria-label="Reels" aria-roledescription="карусель">
        {all.map((p, i) => (
          <ReelSlide
            key={p.id}
            post={p}
            index={i}
            status={status(i)}
            pool={pool}
            visible={visible}
            commentsOpen={i === active && sheetOpen}
            onComments={openComments}
            onClean={onClean}
            control={control}
          />
        ))}
        <section className="rl-slide rl-slide--end" aria-label="Конец ленты">
          {list.hasNextPage || list.isFetchingNextPage ? (
            <span className="rl-spinner rl-spinner--static" role="status" aria-label="Загружаем ещё" />
          ) : (
            <div className="rl-message">
              <span className="rl-message__icon">
                <Sparkles size={30} />
              </span>
              <h2>Вы посмотрели все Reels</h2>
              <p>Новые появятся, как только авторы их загрузят.</p>
              <div className="rl-message__row">
                <button type="button" className="rl-cta rl-cta--ghost" onClick={() => go(0)}>
                  <ChevronUp size={18} /> К началу
                </button>
                <Link to="/reels/new" className="rl-cta">
                  <Plus size={18} /> Загрузить свой
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>

      {layout !== 'narrow' && (
        <div className="rl-arrows">
          <button type="button" className="rl-arrow" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Предыдущий ролик">
            <ChevronUp size={22} />
          </button>
          <button type="button" className="rl-arrow" onClick={() => go(active + 1)} disabled={active >= total} aria-label="Следующий ролик">
            <ChevronDown size={22} />
          </button>
        </div>
      )}

      {sheetPost && <CommentsSheet key={side ? 'side' : sheetPost.id} post={sheetPost} side={side} onClose={closeComments} />}
    </>
  );
}

/** На рабочем столе клавиши слушает только верхнее окно. */
function isFrontmost(host: HTMLElement): boolean {
  const win = host.closest<HTMLElement>('.desk-win');
  if (!win) return true;
  if (document.querySelector('.desk-win--active')) return win.classList.contains('desk-win--active');
  const z = (el: HTMLElement) => Number(el.style.zIndex) || 0;
  const wins = [...document.querySelectorAll<HTMLElement>('.desk-win:not([hidden])')];
  return wins.every((w) => z(w) <= z(win));
}

// ─── Состояния: загрузка, ошибка, пусто ─────────────────────────────────────

function FeedSkeleton() {
  return (
    <div className="rl-feed rl-feed--static" aria-busy="true" aria-label="Загрузка Reels">
      <div className="rl-slide is-active">
        <div className="rl-slide__inner">
          <div className="rl-stage rl-stage--skeleton">
            <span className="rl-skel-shine" aria-hidden />
            <div className="rl-skel-info" aria-hidden>
              <span style={{ width: '42%' }} />
              <span style={{ width: '86%' }} />
              <span style={{ width: '64%' }} />
            </div>
          </div>
          <div className="rl-rail rl-rail--skeleton" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={i === 0 ? 'is-avatar' : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedMessage({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rl-feed rl-feed--static">
      <div className="rl-slide is-active">
        <div className="rl-message">
          <span className="rl-message__icon">{icon}</span>
          <h2>{title}</h2>
          <p>{text}</p>
          {action && <div className="rl-message__row">{action}</div>}
        </div>
      </div>
    </div>
  );
}

function FeedEmpty({ mode }: { mode: FeedMode | 'mine' }) {
  if (mode === 'following')
    return (
      <FeedMessage
        icon={<UserPlus size={30} />}
        title="Здесь появятся Reels ваших подписок"
        text="Подпишитесь на авторов во вкладке «Для вас» — нажмите «+» у аватара."
        action={
          <Link to="/reels" replace className="rl-cta">
            Открыть «Для вас»
          </Link>
        }
      />
    );
  return (
    <FeedMessage
      icon={<Clapperboard size={30} />}
      title={mode === 'trending' ? 'Популярных Reels пока нет' : mode === 'mine' ? 'У вас пока нет Reels' : 'Reels пока нет'}
      text="Загрузите первое вертикальное видео — его увидят все."
      action={
        <Link to="/reels/new" className="rl-cta">
          <Plus size={18} /> Загрузить Reels
        </Link>
      }
    />
  );
}
