/**
 * Окно «Новая публикация» — по макету: слева подраздел «Что публикуем»
 * (Пост, История, Reels, Видео, Черновики, Запланированные), справа — редактор
 * выбранного типа. Пост — обычный редактор записи; Reels и Видео — загрузка
 * ролика; История, Черновики и Запланированные ведут в свои разделы.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Calendar, Clapperboard, PenLine, Search, SquarePlay, Timer, Type } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { Button } from '../../shared/ui';
import { PostComposer } from '../posts/PostComposer';
import { UploadVideoForm } from '../video/upload';
import { activeId, closeWindow } from '../desktop/fx';
import './create.css';

type Tab = 'post' | 'story' | 'reels' | 'video';

const KINDS: { id: Tab; label: string; icon: typeof Type; hint: string }[] = [
  { id: 'post', label: 'Пост', icon: Type, hint: 'текст, фото и видео' },
  { id: 'story', label: 'История', icon: Timer, hint: 'на 24 часа' },
  { id: 'reels', label: 'Reels', icon: Clapperboard, hint: 'вертикальное видео' },
  { id: 'video', label: 'Видео', icon: SquarePlay, hint: 'длинный ролик' },
];

/** Закрыть окно создания (на ПК) или вернуться в ленту (на телефоне). */
function dismiss(navigate: ReturnType<typeof useNavigate>) {
  const id = activeId();
  if (id) void closeWindow(id);
  else navigate('/home');
}

export function CreatePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('post');
  const [q, setQ] = useState('');

  const links: { label: string; icon: typeof Type; to: string }[] = [
    { label: 'Черновики', icon: PenLine, to: '/feed/drafts' },
    { label: 'Запланированные', icon: Calendar, to: '/feed/scheduled' },
  ];
  const ql = q.trim().toLowerCase();
  const kinds = ql ? KINDS.filter((k) => k.label.toLowerCase().includes(ql)) : KINDS;
  const extra = ql ? links.filter((l) => l.label.toLowerCase().includes(ql)) : links;

  return (
    <div className="pk-root pub">
      <aside className="pub-nav">
        <label className="pub-nav__search">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти подраздел" aria-label="Найти подраздел" />
        </label>
        <div className="pub-nav__title">Что публикуем</div>
        {kinds.map((k) => (
          <button key={k.id} type="button" className={cn('pub-item', tab === k.id && 'pub-item--on')} onClick={() => setTab(k.id)}>
            <span className={cn('pub-item__ic', `pub-item__ic--${k.id}`)}>
              <k.icon size={16} />
            </span>
            {k.label}
          </button>
        ))}
        {extra.length > 0 && <div className="pub-nav__sep" />}
        {extra.map((l) => (
          <button key={l.to} type="button" className="pub-item pub-item--link" onClick={() => navigate(l.to)}>
            <span className="pub-item__ic pub-item__ic--muted">
              <l.icon size={16} />
            </span>
            {l.label}
          </button>
        ))}
      </aside>

      <main className="pub-main">
        {tab === 'post' && (
          <div className="pub-card">
            <PostComposer variant="card" autoFocus onDone={() => dismiss(navigate)} />
            <div className="pub-card__note small muted">Фото и видео добавляются кнопками в редакторе · черновик сохраняется сам</div>
          </div>
        )}
        {tab === 'reels' && (
          <div className="pub-upload">
            <h2 className="pub-upload__h">Новый Reels</h2>
            <UploadVideoForm kind="short" onDone={() => dismiss(navigate)} />
          </div>
        )}
        {tab === 'video' && (
          <div className="pub-upload">
            <h2 className="pub-upload__h">Новое видео</h2>
            <UploadVideoForm kind="video" onDone={() => dismiss(navigate)} />
          </div>
        )}
        {tab === 'story' && (
          <div className="pub-story">
            <span className="pub-story__sun">
              <Timer size={30} />
            </span>
            <b>История</b>
            <span className="muted">Фото или видео, которое исчезнет через 24 часа</span>
            <Button pill onClick={() => navigate('/stories/new')}>
              Открыть редактор историй
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
