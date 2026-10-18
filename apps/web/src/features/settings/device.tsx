/** Настройки этого устройства: звуки, «Не беспокоить», шрифт и углы, поведение, энергосбережение. */
import { useState } from 'react';
import { BatteryCharging, BellRing, Gauge, Hand, Home, Maximize2, Minus, Moon, MousePointer2, Orbit, Play, RotateCcw, Type, Volume2, X } from 'lucide-react';
import { playSound } from '../../shared/lib/sounds';
import { isQuietNow, usePrefs, type Corners, type FontFamily, type StartPage } from '../../shared/stores/prefs';
import { cn } from '../../shared/lib/format';
import { Button, Notice, SettingRow, Switch } from '../../shared/ui';
import { useMediaQuery } from '../../shared/hooks';
import { toast } from '../../shared/stores/ui';
import { useDesktop } from '../desktop/store';
import { Panel, SettingsPage } from './common';

export function SoundsSettings() {
  const prefs = usePrefs();
  const sounds = prefs.sounds ?? { messages: true, sent: true, calls: true, volume: 0.6 };
  const set = (patch: Partial<typeof sounds>) => prefs.set({ sounds: { ...sounds, ...patch } });
  return (
    <SettingsPage title="Звуки" subtitle="Хранятся на этом устройстве" icon={<Volume2 size={22} />}>
      <Panel title="Громкость">
        <div className="row gap-3" style={{ padding: '12px 16px 16px' }}>
          <Volume2 size={18} className="faint" />
          <input
            type="range"
            className="grow"
            min={0}
            max={1}
            step={0.05}
            value={sounds.volume}
            onChange={(e) => set({ volume: Number(e.target.value) })}
            aria-label="Громкость звуков"
          />
          <span className="small muted" style={{ width: 40, textAlign: 'right' }}>
            {Math.round(sounds.volume * 100)}%
          </span>
          <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={() => playSound('test')}>
            Проверить
          </Button>
        </div>
      </Panel>
      <Panel title="Когда звучать">
        <SettingRow title="Входящие сообщения" description="И уведомления — лайки, ответы, подписчики" control={<Switch checked={sounds.messages} onChange={(v) => set({ messages: v })} label="Входящие" />} />
        <SettingRow title="Отправка сообщения" description="Короткий «щелчок» после отправки" control={<Switch checked={sounds.sent} onChange={(v) => set({ sent: v })} label="Отправка" />} />
        <SettingRow title="Мелодия звонка" description="Если выключить, входящий звонок появится беззвучно" control={<Switch checked={sounds.calls} onChange={(v) => set({ calls: v })} label="Звонки" />} />
      </Panel>
    </SettingsPage>
  );
}

export function QuietSettings() {
  const prefs = usePrefs();
  const q = prefs.quietHours ?? { enabled: false, from: '23:00', to: '08:00' };
  const set = (patch: Partial<typeof q>) => prefs.set({ quietHours: { ...q, ...patch } });
  const quiet = isQuietNow(q);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  return (
    <SettingsPage title="Не беспокоить" subtitle="Тихие часы и системные уведомления" icon={<Moon size={22} />}>
      {quiet && <Notice kind="warning">Сейчас тихие часы: сообщения приходят, но без звука и всплывающих уведомлений.</Notice>}
      <Panel title="Тихие часы" footer="Звонки в тихие часы приходят беззвучно. Работает по местному времени устройства.">
        <SettingRow title="По расписанию" description="Каждый день в выбранное время" control={<Switch checked={q.enabled} onChange={(v) => set({ enabled: v })} label="Тихие часы" />} />
        <div className="row gap-3" style={{ padding: '4px 16px 16px', opacity: q.enabled ? 1 : 0.5 }}>
          <label className="field grow">
            <span className="field__label">С</span>
            <input className="input" type="time" value={q.from} disabled={!q.enabled} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="field grow">
            <span className="field__label">До</span>
            <input className="input" type="time" value={q.to} disabled={!q.enabled} onChange={(e) => set({ to: e.target.value })} />
          </label>
        </div>
      </Panel>
      <Panel title="Системные уведомления" footer="Показываются, когда вкладка SpaceUp в фоне.">
        <SettingRow
          title="Уведомления на рабочем столе"
          description={perm === 'denied' ? 'Запрещено в настройках браузера — разрешите вручную' : 'Новые сообщения и события в углу экрана'}
          control={
            <Switch
              checked={prefs.desktopNotify && perm === 'granted'}
              disabled={perm === 'denied' || typeof Notification === 'undefined'}
              label="Уведомления на рабочем столе"
              onChange={async (v) => {
                if (v && perm !== 'granted') {
                  const p = await Notification.requestPermission();
                  setPerm(p);
                  if (p !== 'granted') return;
                }
                prefs.set({ desktopNotify: v });
              }}
            />
          }
        />
      </Panel>
    </SettingsPage>
  );
}

const FONTS: { id: FontFamily; label: string; sample: string; css: string }[] = [
  { id: 'inter', label: 'Inter', sample: 'Современный и чёткий', css: "'Inter Variable', system-ui, sans-serif" },
  { id: 'system', label: 'Системный', sample: 'Как в вашей ОС', css: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  { id: 'rounded', label: 'Округлый', sample: 'Мягкий и дружелюбный', css: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif" },
  { id: 'serif', label: 'С засечками', sample: 'Книжный, для чтения', css: "'Iowan Old Style', Georgia, 'PT Serif', serif" },
  { id: 'mono', label: 'Моноширинный', sample: 'Для любителей кода', css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

const CORNERS: { id: Corners; label: string; r: number }[] = [
  { id: 'sharp', label: 'Строгие', r: 6 },
  { id: 'normal', label: 'Обычные', r: 14 },
  { id: 'round', label: 'Круглые', r: 24 },
];

export function FontSettings() {
  const prefs = usePrefs();
  return (
    <SettingsPage title="Шрифт и углы" subtitle="Характер интерфейса. Применяется мгновенно" icon={<Type size={22} />}>
      <Panel title="Шрифт">
        <div className="choice-grid">
          {FONTS.map((f) => (
            <button key={f.id} type="button" className={cn('choice-card', prefs.fontFamily === f.id && 'choice-card--on')} onClick={() => prefs.set({ fontFamily: f.id })} aria-pressed={prefs.fontFamily === f.id}>
              <span className="choice-card__big" style={{ fontFamily: f.css }}>
                Аа
              </span>
              <b>{f.label}</b>
              <span className="xs muted" style={{ fontFamily: f.css }}>
                {f.sample}
              </span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Скругление углов">
        <div className="choice-grid">
          {CORNERS.map((c) => (
            <button key={c.id} type="button" className={cn('choice-card', prefs.corners === c.id && 'choice-card--on')} onClick={() => prefs.set({ corners: c.id })} aria-pressed={prefs.corners === c.id}>
              <span className="corner-demo" style={{ borderRadius: c.r }}>
                <span style={{ borderRadius: Math.max(3, c.r - 6) }} />
              </span>
              <b>{c.label}</b>
            </button>
          ))}
        </div>
      </Panel>
    </SettingsPage>
  );
}

const START: { id: StartPage; label: string }[] = [
  { id: '/home', label: 'Главная — лента' },
  { id: '/chats', label: 'Чаты' },
  { id: '/channels', label: 'Каналы' },
  { id: '/comets', label: 'Кометы' },
];

export function BehaviorSettings() {
  const prefs = usePrefs();
  return (
    <SettingsPage title="Поведение" subtitle="Как приложение ведёт себя на этом устройстве" icon={<Gauge size={22} />}>
      <Panel title="Запуск">
        <SettingRow
          icon={<Home size={18} />}
          tile="tile-violet"
          title="Стартовая страница"
          description="Что открывается при входе в SpaceUp"
          control={
            <select className="select" style={{ width: 'auto' }} value={START.some((x) => x.id === prefs.startPage) ? prefs.startPage : '/home'} onChange={(e) => prefs.set({ startPage: e.target.value as StartPage })} aria-label="Стартовая страница">
              {START.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          }
        />
      </Panel>
      <Panel title="Ввод текста">
        <SettingRow title="Отправлять по Enter" description="Shift+Enter — новая строка. На телефоне Enter всегда переносит строку" control={<Switch checked={prefs.enterToSend} onChange={(v) => prefs.set({ enterToSend: v })} label="Enter" />} />
        <SettingRow title="Проверка орфографии" description="Подчёркивать ошибки в поле сообщения" control={<Switch checked={prefs.spellcheck ?? true} onChange={(v) => prefs.set({ spellcheck: v })} label="Орфография" />} />
      </Panel>
      <Panel title="Сообщения">
        <SettingRow title="Крупные эмодзи" description="Сообщение из 1–3 эмодзи показывается без пузыря и крупно" control={<Switch checked={prefs.jumboEmoji ?? true} onChange={(v) => prefs.set({ jumboEmoji: v })} label="Крупные эмодзи" />} />
        <SettingRow title="Автовоспроизведение видео" description="Кометы, кружки и истории запускаются сами" control={<Switch checked={prefs.autoplayVideo} onChange={(v) => prefs.set({ autoplayVideo: v })} label="Автовоспроизведение" />} />
      </Panel>
    </SettingsPage>
  );
}

export function PowerSettings() {
  const prefs = usePrefs();
  const saving = !prefs.glass && prefs.aurora === 'off' && prefs.reduceMotion && !prefs.autoplayVideo && prefs.dataSaver;
  const apply = (on: boolean) =>
    prefs.set(
      on
        ? { glass: false, aurora: 'off', reduceMotion: true, autoplayVideo: false, dataSaver: true }
        : { glass: true, aurora: 'animated', reduceMotion: false, autoplayVideo: true, dataSaver: false },
    );
  return (
    <SettingsPage title="Энергосбережение" subtitle="Меньше эффектов — дольше работает батарея и быстрее на слабых устройствах" icon={<BatteryCharging size={22} />}>
      <Panel>
        <SettingRow
          icon={<BatteryCharging size={18} />}
          tile="tile-green"
          title="Режим экономии"
          description="Выключает стекло, сияние, анимации, автозапуск видео и предзагрузку"
          control={<Switch checked={saving} onChange={apply} label="Режим экономии" />}
        />
      </Panel>
      <Panel title="По отдельности">
        <SettingRow title="Матовое стекло" description="Размытие под панелями" control={<Switch checked={prefs.glass} onChange={(v) => prefs.set({ glass: v })} label="Стекло" />} />
        <SettingRow
          title="Северное сияние"
          description="Живой фон за интерфейсом"
          control={
            <select className="select" style={{ width: 'auto' }} value={prefs.aurora} onChange={(e) => prefs.set({ aurora: e.target.value as typeof prefs.aurora })} aria-label="Сияние">
              <option value="animated">Живое</option>
              <option value="static">Неподвижное</option>
              <option value="off">Выключено</option>
            </select>
          }
        />
        <SettingRow title="Меньше движения" description="Без анимаций и плавных переходов" control={<Switch checked={prefs.reduceMotion} onChange={(v) => prefs.set({ reduceMotion: v })} label="Меньше движения" />} />
        <SettingRow title="Автовоспроизведение видео" control={<Switch checked={prefs.autoplayVideo} onChange={(v) => prefs.set({ autoplayVideo: v })} label="Автовоспроизведение" />} />
        <SettingRow title="Экономия трафика" description="Не загружать видео заранее" control={<Switch checked={prefs.dataSaver} onChange={(v) => prefs.set({ dataSaver: v })} label="Экономия трафика" />} />
      </Panel>
      <Notice icon={<BellRing size={16} />}>Звуки и уведомления не зависят от режима экономии — их можно настроить в разделе «Уведомления».</Notice>
    </SettingsPage>
  );
}

/** «Пространство»: окна разделов на поле с точками — как рабочий стол компьютера. */
export function SpaceModeSettings() {
  const prefs = usePrefs();
  const wide = useMediaQuery('(min-width: 900px)');
  const reset = () => {
    useDesktop.getState().reset();
    toast({ text: 'Расположение окон сброшено', kind: 'success' });
  };
  return (
    <SettingsPage title="Пространство" subtitle="Окна разделов на бесконечном поле — как рабочий стол компьютера" icon={<Orbit size={22} />}>
      {!wide && <Notice kind="warning">Пространство работает на экранах от 900 пикселей — на планшете в альбомной ориентации и на компьютере.</Notice>}
      <Panel>
        <SettingRow
          icon={<Orbit size={18} />}
          tile="tile-violet"
          title="Включить Пространство"
          description="Слева — разделы, по центру — поле с окнами. Обычный интерфейс вернётся одной кнопкой"
          control={<Switch checked={!!prefs.spaceMode} disabled={!wide} onChange={(v) => prefs.set({ spaceMode: v })} label="Пространство" />}
        />
      </Panel>
      <Panel title="Как пользоваться">
        <SettingRow icon={<MousePointer2 size={18} />} tile="tile-blue" title="Колесо мыши на пустом поле" description="Приблизить и отдалить. Ctrl и колесо — масштаб в любом месте, Ctrl 0 — вернуть 100%" />
        <SettingRow icon={<Hand size={18} />} tile="tile-cyan" title="Перетаскивание и два пальца" description="Тяните пустое место, чтобы двигать поле. Сведите или разведите пальцы — масштаб" />
        <SettingRow icon={<Minus size={18} />} tile="tile-green" title="Свернуть" description="Окно уходит в панель слева и остаётся открытым — нажмите на раздел, чтобы вернуть" />
        <SettingRow icon={<Maximize2 size={18} />} tile="tile-orange" title="На весь экран" description="Кнопка в заголовке или двойной щелчок по нему. Края окна можно тянуть" />
        <SettingRow icon={<X size={18} />} tile="tile-red" title="Закрыть" description="Shift и щелчок по разделу — открыть ещё одно окно того же раздела" />
      </Panel>
      <Panel footer="Окна, их размеры и масштаб запоминаются на этом устройстве.">
        <div style={{ padding: 16 }}>
          <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={reset}>
            Сбросить расположение окон
          </Button>
        </div>
      </Panel>
    </SettingsPage>
  );
}
