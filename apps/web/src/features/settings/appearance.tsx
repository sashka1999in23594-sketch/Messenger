import { useEffect, useRef, type ReactNode } from 'react';
import { Check, CheckCheck, Monitor, Moon, Palette, Sparkles, Sun } from 'lucide-react';
import { usePrefs, type Accent, type AuroraMode, type Palette as PaletteId, type Theme } from '../../shared/stores/prefs';
import { cn } from '../../shared/lib/format';
import { Segmented, SettingRow, Switch } from '../../shared/ui';
import { Panel, SettingsPage } from './common';

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: 'aurora', label: 'Аврора', hint: 'Фиолетовое сияние' },
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

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'dark', label: 'Тёмная', icon: <Moon size={16} /> },
  { id: 'light', label: 'Светлая', icon: <Sun size={16} /> },
  { id: 'system', label: 'Как в системе', icon: <Monitor size={16} /> },
];

/** Миниатюра приложения в заданной теме — рисуется теми же токенами, что и настоящий интерфейс. */
function MiniApp({ theme, palette, accent, big }: { theme: 'light' | 'dark'; palette: PaletteId; accent: Accent; big?: boolean }) {
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

export function AppearanceSettings({ section }: { section: 'theme' | 'accent' | 'text' | 'density' }) {
  const prefs = usePrefs();
  const update = prefs.set;
  const resolved: 'light' | 'dark' =
    prefs.theme === 'system' ? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : prefs.theme;
  const refs = useRef<Record<string, HTMLElement | null>>({});

  // Подразделы оформления — якоря на одной странице
  useEffect(() => {
    if (section !== 'theme') refs.current[section]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [section]);

  return (
    <SettingsPage title="Оформление" subtitle="Тема, палитра, акцент и эффекты. Хранится на этом устройстве" icon={<Palette size={22} />}>
      <div className="appearance-hero">
        <MiniApp theme={resolved} palette={prefs.palette} accent={prefs.accent} big />
        <div className="appearance-hero__text">
          <div className="appearance-hero__name">
            {PALETTES.find((p) => p.id === prefs.palette)?.label} · {THEMES.find((t) => t.id === prefs.theme)?.label.toLowerCase()}
          </div>
          <div className="small muted">Всё меняется мгновенно — попробуйте разные сочетания.</div>
        </div>
      </div>

      <Panel title="Тема">
        <div className="theme-cards" ref={(el) => void (refs.current.theme = el)}>
          {THEMES.map((t) => (
            <button key={t.id} className="theme-card" aria-pressed={prefs.theme === t.id} onClick={() => update({ theme: t.id })}>
              {t.id === 'system' ? (
                <span className="theme-card__split">
                  <MiniApp theme="light" palette={prefs.palette} accent={prefs.accent} />
                  <MiniApp theme="dark" palette={prefs.palette} accent={prefs.accent} />
                </span>
              ) : (
                <MiniApp theme={t.id} palette={prefs.palette} accent={prefs.accent} />
              )}
              <span className="theme-card__label">
                {t.icon}
                {t.label}
                {prefs.theme === t.id && <Check size={16} className="theme-card__check" />}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Палитра" footer="Палитра задаёт цвета фонового сияния и акцент по умолчанию.">
        <div className="palette-cards">
          {PALETTES.map((p) => (
            <button key={p.id} className="palette-card" aria-pressed={prefs.palette === p.id} onClick={() => update({ palette: p.id })} data-theme={resolved} data-palette={p.id} data-accent="auto">
              <span className="palette-card__swatch">
                <span />
                <span />
                <span />
              </span>
              <span className="palette-card__label">{p.label}</span>
              <span className="palette-card__hint">{p.hint}</span>
              {prefs.palette === p.id && (
                <span className="palette-card__check">
                  <Check size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
      </Panel>

      <section className="panel" ref={(el) => void (refs.current.accent = el)}>
        <div className="panel__title">Акцент</div>
        <div className="accent-swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              className="accent-swatch"
              data-accent={a.id}
              data-palette={prefs.palette}
              aria-pressed={prefs.accent === a.id}
              aria-label={a.label}
              title={a.label}
              onClick={() => update({ accent: a.id })}
            >
              {a.id === 'auto' && <Sparkles size={18} />}
              {prefs.accent === a.id && a.id !== 'auto' && <Check size={18} />}
            </button>
          ))}
        </div>
        <div className="panel__footer">Кнопки, выделение, исходящие сообщения и значки окрасятся в градиент выбранного акцента.</div>
      </section>

      <Panel title="Фон и стекло">
        <SettingRow
          icon={<Sparkles size={18} />}
          title="Северное сияние"
          description="Мягкие цветные пятна на фоне приложения"
          control={
            <Segmented<AuroraMode>
              value={prefs.aurora}
              onChange={(v) => update({ aurora: v })}
              options={[
                { value: 'animated', label: 'Живое' },
                { value: 'static', label: 'Статичное' },
                { value: 'off', label: 'Выкл.' },
              ]}
            />
          }
        />
        <SettingRow
          title="Матовое стекло"
          description="Полупрозрачные панели с размытием. Выключите, если устройство тормозит"
          control={<Switch checked={prefs.glass} onChange={(v) => update({ glass: v })} label="Матовое стекло" />}
        />
        <SettingRow
          title="Уменьшить движение"
          description="Отключить анимации и переходы"
          control={<Switch checked={prefs.reduceMotion} onChange={(v) => update({ reduceMotion: v })} label="Уменьшить движение" />}
        />
      </Panel>

      <section className="panel" ref={(el) => void (refs.current.text = el)}>
        <div className="panel__title">Размер текста</div>
        <div className="col gap-3" style={{ padding: 16 }}>
          <input className="range" type="range" min={0.85} max={1.3} step={0.05} value={prefs.fontScale} onChange={(e) => update({ fontScale: Number(e.target.value) })} aria-label="Масштаб текста" />
          <div className="row between small muted">
            <span style={{ fontSize: 12 }}>А</span>
            <span className="bold" style={{ color: 'var(--text)' }}>
              {Math.round(prefs.fontScale * 100)}%
            </span>
            <span style={{ fontSize: 18 }}>А</span>
          </div>
          <div className="text-preview">
            <span className="text-preview__in">Привет! Так выглядит текст в Omni 👋</span>
            <span className="text-preview__out">Отлично читается ✨</span>
          </div>
        </div>
      </section>

      <section className="panel" ref={(el) => void (refs.current.density = el)}>
        <div className="panel__title">Плотность</div>
        <SettingRow
          title="Компактный режим"
          description="Меньше отступов — больше информации на экране"
          control={<Switch checked={prefs.density === 'compact'} onChange={(v) => update({ density: v ? 'compact' : 'comfortable' })} label="Компактный режим" />}
        />
      </section>
    </SettingsPage>
  );
}
