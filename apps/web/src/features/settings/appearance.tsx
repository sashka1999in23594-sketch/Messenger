import { useEffect, useRef, type ReactNode } from 'react';
import { Check, Monitor, Moon, Palette, Sparkles, Sun } from 'lucide-react';
import { usePrefs, type AuroraMode, type Theme } from '../../shared/stores/prefs';
import { AccentPicker, MiniApp, PALETTES, PalettePicker, Segmented, SettingRow, Switch } from '../../shared/ui';
import { Panel, SettingsPage } from './common';

const THEMES: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'dark', label: 'Тёмная', icon: <Moon size={16} /> },
  { id: 'light', label: 'Светлая', icon: <Sun size={16} /> },
  { id: 'system', label: 'Как в системе', icon: <Monitor size={16} /> },
];

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
    <SettingsPage title="Оформление" subtitle="Хранится на этом устройстве" icon={<Palette size={22} />}>
      <div className="appearance-hero">
        <MiniApp theme={resolved} palette={prefs.palette} accent={prefs.accent} big />
        <div className="appearance-hero__text">
          <div className="appearance-hero__name">
            {PALETTES.find((p) => p.id === prefs.palette)?.label} · {THEMES.find((t) => t.id === prefs.theme)?.label.toLowerCase()}
          </div>
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
        <PalettePicker />
      </Panel>

      <section className="panel" ref={(el) => void (refs.current.accent = el)}>
        <div className="panel__title">Акцент</div>
        <AccentPicker />
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
            <span className="text-preview__in">Привет! Так выглядит текст в Sunnet 👋</span>
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
