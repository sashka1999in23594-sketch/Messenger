import { Check, CheckCheck, Sparkles } from 'lucide-react';
import { usePrefs, type Accent, type Palette as PaletteId } from '../stores/prefs';
import { cn } from '../lib/format';

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: 'aurora', label: 'Sunnet', hint: 'Лазурь и солнце' },
  { id: 'sunset', label: 'Закат', hint: 'Тёплый вечер' },
  { id: 'ocean', label: 'Океан', hint: 'Глубокая синева' },
  { id: 'forest', label: 'Лес', hint: 'Свежая зелень' },
  { id: 'sakura', label: 'Сакура', hint: 'Нежный розовый' },
  { id: 'midnight', label: 'Полночь', hint: 'Чёрный для OLED' },
  { id: 'graphite', label: 'Графит', hint: 'Строгий нейтральный' },
];

export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'auto', label: 'Как в палитре' },
  { id: 'violet', label: 'Фиолетовый' },
  { id: 'blue', label: 'Синий' },
  { id: 'cyan', label: 'Бирюзовый' },
  { id: 'green', label: 'Зелёный' },
  { id: 'yellow', label: 'Янтарный' },
  { id: 'orange', label: 'Оранжевый' },
  { id: 'red', label: 'Красный' },
  { id: 'pink', label: 'Розовый' },
  { id: 'purple', label: 'Пурпурный' },
];

/** Миниатюра приложения в заданной теме — рисуется теми же токенами, что и настоящий интерфейс. */
export function MiniApp({ theme, palette, accent, big }: { theme: 'light' | 'dark'; palette: PaletteId; accent: Accent; big?: boolean }) {
  return (
    <span className={cn('mini-app', big && 'mini-app--big')} data-theme={theme} data-palette={palette} data-accent={accent} aria-hidden>
      <span className="mini-app__aurora" />
      <span className="mini-app__rail">
        <span className="mini-app__logo" />
        <span className="mini-app__dot mini-app__dot--on" />
        <span className="mini-app__dot" />
        <span className="mini-app__dot" />
      </span>
      <span className="mini-app__main">
        <span className="mini-app__bubble mini-app__bubble--in">{big ? 'Привет! Как тебе новая тема? 👋' : ''}</span>
        <span className="mini-app__bubble mini-app__bubble--out">
          {big ? (
            <>
              Очень красиво ✨ <CheckCheck size={12} />
            </>
          ) : (
            ''
          )}
        </span>
        <span className="mini-app__bubble mini-app__bubble--in mini-app__bubble--short">{big ? 'Сияние двигается!' : ''}</span>
        <span className="mini-app__composer">
          <span />
          <span className="mini-app__send" />
        </span>
      </span>
    </span>
  );
}


/** Тема, которая сейчас фактически применена (с учётом «как в системе»). */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = usePrefs((s) => s.theme);
  if (theme !== 'system') return theme;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function PalettePicker() {
  const palette = usePrefs((s) => s.palette);
  const set = usePrefs((s) => s.set);
  const resolved = useResolvedTheme();
  return (
    <div className="palette-cards">
      {PALETTES.map((p) => (
        <button key={p.id} className="palette-card" aria-pressed={palette === p.id} onClick={() => set({ palette: p.id })} data-theme={resolved} data-palette={p.id} data-accent="auto">
          <span className="palette-card__swatch">
            <span />
            <span />
            <span />
          </span>
          <span className="palette-card__label">{p.label}</span>
          <span className="palette-card__hint">{p.hint}</span>
          {palette === p.id && (
            <span className="palette-card__check">
              <Check size={14} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function AccentPicker() {
  const accent = usePrefs((s) => s.accent);
  const palette = usePrefs((s) => s.palette);
  const set = usePrefs((s) => s.set);
  return (
    <div className="accent-swatches">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          className="accent-swatch"
          data-accent={a.id}
          data-palette={palette}
          aria-pressed={accent === a.id}
          aria-label={a.label}
          title={a.label}
          onClick={() => set({ accent: a.id })}
        >
          {a.id === 'auto' && <Sparkles size={18} />}
          {accent === a.id && a.id !== 'auto' && <Check size={18} />}
        </button>
      ))}
    </div>
  );
}
