/** Обои переписки: превью и выбор (общие — в настройках, свои — в информации о чате). */
import { usePrefs, type Wallpaper } from '../../shared/stores/prefs';
import { cn } from '../../shared/lib/format';
import './wallpapers.css';

export const WALLPAPERS: { id: Wallpaper; label: string }[] = [
  { id: 'aurora', label: 'Сияние' },
  { id: 'mesh', label: 'Акцент' },
  { id: 'sunset', label: 'Закат' },
  { id: 'ocean', label: 'Океан' },
  { id: 'forest', label: 'Лес' },
  { id: 'night', label: 'Звёзды' },
  { id: 'candy', label: 'Конфетти' },
  { id: 'grid', label: 'Сетка' },
  { id: 'waves', label: 'Волны' },
  { id: 'plain', label: 'Без обоев' },
];

/** Обои для чата: свои у чата или общие */
export function useWallpaper(chatId?: string | null): Wallpaper {
  return usePrefs((s) => (chatId && s.chatWallpapers?.[chatId]) || s.wallpaper || 'aurora');
}

export function ChatWallpaper({ chatId }: { chatId?: string | null }) {
  return <div className="chat-wallpaper" data-wp={useWallpaper(chatId)} aria-hidden />;
}

function Preview({ id }: { id: Wallpaper }) {
  return (
    <span className="wp-tile__preview">
      <span className="chat-wallpaper" data-wp={id} />
      <span className="wp-tile__bubble" style={{ left: 8, top: '22%', width: '55%' }} />
      <span className="wp-tile__bubble wp-tile__bubble--out" style={{ right: 8, top: '42%', width: '48%' }} />
      <span className="wp-tile__bubble" style={{ left: 8, top: '62%', width: '38%' }} />
    </span>
  );
}

export function WallpaperPicker({ value, onChange, inherit }: { value: Wallpaper | null; onChange: (w: Wallpaper | null) => void; inherit?: Wallpaper }) {
  return (
    <div className="wp-grid" role="radiogroup" aria-label="Обои">
      {inherit && (
        <button type="button" role="radio" aria-checked={value === null} className={cn('wp-tile', value === null && 'wp-tile--active')} onClick={() => onChange(null)}>
          <Preview id={inherit} />
          Как везде
        </button>
      )}
      {WALLPAPERS.map((w) => (
        <button key={w.id} type="button" role="radio" aria-checked={value === w.id} className={cn('wp-tile', value === w.id && 'wp-tile--active')} onClick={() => onChange(w.id)}>
          <Preview id={w.id} />
          {w.label}
        </button>
      ))}
    </div>
  );
}

/** Свои обои для конкретного чата (null — как везде) */
export function setChatWallpaper(chatId: string, w: Wallpaper | null) {
  const { chatWallpapers, set } = usePrefs.getState();
  const next = { ...(chatWallpapers ?? {}) };
  if (w) next[chatId] = w;
  else delete next[chatId];
  set({ chatWallpapers: next });
}
