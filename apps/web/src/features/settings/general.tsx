import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Accessibility, BatteryCharging, Bell, Database, Flag, Info, Keyboard, Languages, Lock, MessageCircle, Moon, Palette, Settings, ShieldCheck, Volume2, Zap } from 'lucide-react';
import { APP_NAME, REPORT_REASON_LABELS, type ReportReason } from '@omni/shared';
import { sections } from '../../app/navigation';
import { api } from '../../shared/api/client';
import { flatPages, queryClient, useCursorList } from '../../shared/api/query';
import { usePrefs } from '../../shared/stores/prefs';
import { toast } from '../../shared/stores/ui';
import { fileSize, fullDate } from '../../shared/lib/format';
import { Button, confirm, EmptyState, Notice, PageHeader, SettingRow, Switch } from '../../shared/ui';
import { Panel, SettingsPage, useNotificationPrefs } from './common';
import { useWallpaper, WallpaperPicker } from '../chats/wallpapers';
import { SettingsSearch } from './search';

const QUICK: { to: string; label: string; icon: React.ReactNode; tile: string }[] = [
  { to: '/settings/appearance/theme', label: 'Оформление', icon: <Palette size={18} />, tile: 'tile-violet' },
  { to: '/settings/notifications', label: 'Уведомления', icon: <Bell size={18} />, tile: 'tile-red' },
  { to: '/settings/privacy/profile', label: 'Приватность', icon: <Lock size={18} />, tile: 'tile-blue' },
  { to: '/settings/security', label: 'Безопасность', icon: <ShieldCheck size={18} />, tile: 'tile-green' },
  { to: '/settings/chats/wallpaper', label: 'Обои чатов', icon: <MessageCircle size={18} />, tile: 'tile-pink' },
  { to: '/settings/power', label: 'Энергосбережение', icon: <BatteryCharging size={18} />, tile: 'tile-lime' },
];

export function SettingsHome() {
  const settings = sections.find((s) => s.id === 'settings')!;
  const [searching, setSearching] = useState(false);
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Настройки" subtitle="Всё, что можно настроить в Sunnet — более 70 параметров" icon={<Settings size={22} />} />
        <SettingsSearch onActive={setSearching} />
        {!searching && (
          <div className="settings-quick">
            {QUICK.map((q) => (
              <Link key={q.to} to={q.to} className="settings-quick__item">
                <span className={`list-item__icon ${q.tile}`}>{q.icon}</span>
                {q.label}
              </Link>
            ))}
          </div>
        )}
        <div className="settings-grid">
          {settings.children
            .filter((n) => !n.adminOnly)
            .map((n) => {
              const Icon = n.icon ?? Settings;
              const links = n.children ?? (n.path ? [n] : []);
              return (
                <div key={n.id} className="settings-tile">
                  <Link to={links[0]?.path ?? '/settings'} className="row" style={{ color: 'inherit', gap: 10 }}>
                    <span className="list-item__icon">
                      <Icon size={18} />
                    </span>
                    <span className="bold">{n.label}</span>
                  </Link>
                  <div className="settings-tile__links">
                    {links.map((l) => (
                      <Link key={l.id} to={l.path ?? '#'}>
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export function NotificationSettingsPage() {
  const { prefs, update } = useNotificationPrefs();
  const navigate = useNavigate();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const rows: [keyof typeof prefs, string, string][] = [
    ['messages', 'Сообщения', 'Всплывающие уведомления о новых сообщениях'],
    ['mentions', 'Упоминания', 'Когда вас отмечают через @'],
    ['replies', 'Ответы и комментарии', 'К вашим публикациям и комментариям'],
    ['likes', 'Отметки «Нравится»', ''],
    ['reposts', 'Репосты и цитаты', ''],
    ['follows', 'Новые подписчики', 'И заявки на подписку'],
    ['communities', 'Сообщества', 'Новые участники ваших сообществ'],
    ['subscriptions', 'Новые публикации', 'От авторов, у которых вы включили «колокольчик»'],
    ['stories', 'Реакции на истории', 'Кто отреагировал на ваши истории'],
  ];
  return (
    <SettingsPage title="Уведомления" icon={<Bell size={22} />}>
      <Panel title="Что присылать">
        {rows.map(([key, title, description]) => (
          <SettingRow key={key} title={title} description={description || undefined} control={<Switch checked={prefs[key]} onChange={(v) => update({ [key]: v })} label={title} />} />
        ))}
        <SettingRow title="Безопасность" description="Новые входы в аккаунт — всегда включено" control={<Switch checked disabled onChange={() => undefined} label="Безопасность" />} />
      </Panel>
      <Panel title="Приватность уведомлений">
        <SettingRow title="Показывать текст" description="Если выключено — только «Новое сообщение»" control={<Switch checked={prefs.showPreviews} onChange={(v) => update({ showPreviews: v })} label="Превью" />} />
      </Panel>
      <Panel title="На этом устройстве">
        <SettingRow icon={<Volume2 size={18} />} tile="tile-blue" title="Звуки" description="Сообщения, отправка, звонки, громкость" onClick={() => navigate('/settings/notifications/sounds')} />
        <SettingRow icon={<Moon size={18} />} tile="tile-indigo" title="Не беспокоить" description="Тихие часы по расписанию и системные уведомления" onClick={() => navigate('/settings/notifications/quiet')} />
        <SettingRow
          title="Разрешение браузера"
          description={perm === 'granted' ? 'Разрешено' : perm === 'denied' ? 'Запрещено в настройках браузера' : 'Не запрошено'}
          control={
            perm !== 'granted' && typeof Notification !== 'undefined' ? (
              <Button size="sm" variant="secondary" onClick={() => void Notification.requestPermission().then(setPerm)}>
                Разрешить
              </Button>
            ) : undefined
          }
        />
      </Panel>
    </SettingsPage>
  );
}

function ChatPreview() {
  const wp = useWallpaper(null);
  const scale = usePrefs((s) => s.messageScale ?? 100);
  return (
    <div className="wp-preview" style={{ '--msg-scale': scale / 100 } as React.CSSProperties}>
      <div className="chat-wallpaper" data-wp={wp} aria-hidden />
      <div className="wp-preview__msg">Привет! Как тебе новые обои? 🌌</div>
      <div className="wp-preview__msg wp-preview__msg--out">Огонь, особенно «Звёзды» ✨</div>
      <div className="wp-preview__msg">Размер текста тоже можно подобрать</div>
    </div>
  );
}

function WallpaperSettings() {
  const prefs = usePrefs();
  const own = Object.keys(prefs.chatWallpapers ?? {}).length;
  return (
    <SettingsPage title="Обои и текст" icon={<Palette size={22} />}>
      <ChatPreview />
      <Panel title="Обои для всех чатов">
        <div style={{ padding: '4px 16px 16px' }}>
          <WallpaperPicker value={prefs.wallpaper ?? 'aurora'} onChange={(w) => w && prefs.set({ wallpaper: w })} />
        </div>
      </Panel>
      <Panel title="Размер текста сообщений" footer="Влияет только на переписку. Общий масштаб интерфейса — в «Оформление → Текст».">
        <div className="row gap-3" style={{ padding: '12px 16px 16px' }}>
          <span className="small">А</span>
          <input
            type="range"
            className="grow"
            min={80}
            max={140}
            step={5}
            value={prefs.messageScale ?? 100}
            onChange={(e) => prefs.set({ messageScale: Number(e.target.value) })}
            aria-label="Размер текста сообщений"
          />
          <span style={{ fontSize: 22 }}>А</span>
          <span className="small muted" style={{ width: 44, textAlign: 'right' }}>
            {prefs.messageScale ?? 100}%
          </span>
        </div>
      </Panel>
      {own > 0 && (
        <Panel>
          <SettingRow
            title="Свои обои у чатов"
            description={`Задано для ${own} ${own === 1 ? 'чата' : 'чатов'}`}
            control={
              <Button size="sm" variant="secondary" onClick={() => prefs.set({ chatWallpapers: {} })}>
                Сбросить
              </Button>
            }
          />
        </Panel>
      )}
    </SettingsPage>
  );
}

export function ChatSettings({ section }: { section: 'input' | 'media' | 'wallpaper' }) {
  const prefs = usePrefs();
  if (section === 'wallpaper') return <WallpaperSettings />;
  return section === 'input' ? (
    <SettingsPage title="Отправка сообщений" icon={<Keyboard size={22} />}>
      <Panel footer="На телефоне Enter всегда переносит строку — отправка кнопкой.">
        <SettingRow title="Отправлять по Enter" description="Shift+Enter — новая строка" control={<Switch checked={prefs.enterToSend} onChange={(v) => prefs.set({ enterToSend: v })} label="Enter" />} />
      </Panel>
    </SettingsPage>
  ) : (
    <SettingsPage title="Медиа и трафик" icon={<MessageCircle size={22} />}>
      <Panel>
        <SettingRow title="Автовоспроизведение видео" description="Reels и истории запускаются сами" control={<Switch checked={prefs.autoplayVideo} onChange={(v) => prefs.set({ autoplayVideo: v })} label="Автовоспроизведение" />} />
        <SettingRow title="Экономия трафика" description="Не загружать видео заранее" control={<Switch checked={prefs.dataSaver} onChange={(v) => prefs.set({ dataSaver: v })} label="Экономия трафика" />} />
      </Panel>
    </SettingsPage>
  );
}

export function DataSettings() {
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then(setEstimate);
  }, []);
  return (
    <SettingsPage title="Данные и память" icon={<Database size={22} />}>
      <Panel title="Хранилище на устройстве">
        <SettingRow title="Используется" description={estimate?.usage !== undefined ? `${fileSize(estimate.usage)} из ${fileSize(estimate.quota ?? 0)}` : 'Неизвестно'} />
        <SettingRow
          title="Очистить кэш"
          description="Временные данные интерфейса. Ключи шифрования и настройки сохранятся"
          control={
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                queryClient.clear();
                if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
                toast({ text: 'Кэш очищен', kind: 'success' });
                void queryClient.invalidateQueries();
              }}
            >
              Очистить
            </Button>
          }
        />
      </Panel>
      <Notice>Сообщения обычных чатов хранятся на сервере и синхронизируются. Секретные чаты расшифровываются только в памяти устройства.</Notice>
    </SettingsPage>
  );
}

export function LanguageSettings() {
  return (
    <SettingsPage title="Язык" icon={<Languages size={22} />}>
      <Panel footer="Интерфейс Sunnet — на русском языке.">
        <label className="list-item audience__option">
          <input type="radio" checked readOnly /> <span className="list-item__body">Русский</span>
        </label>
      </Panel>
    </SettingsPage>
  );
}

export function AccessibilitySettings() {
  const prefs = usePrefs();
  const update = prefs.set;
  return (
    <SettingsPage title="Специальные возможности" icon={<Accessibility size={22} />}>
      <Panel>
        <SettingRow title="Уменьшить движение" description="Отключить анимации и переходы" control={<Switch checked={prefs.reduceMotion} onChange={(v) => update({ reduceMotion: v })} label="Уменьшить движение" />} />
        <SettingRow title="Крупный текст" description="Масштаб 120%" control={<Switch checked={prefs.fontScale >= 1.2} onChange={(v) => update({ fontScale: v ? 1.2 : 1 })} label="Крупный текст" />} />
      </Panel>
      <Notice>Интерфейс поддерживает навигацию с клавиатуры, экранные дикторы (ARIA-метки) и системную тему.</Notice>
    </SettingsPage>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl / ⌘ + K', 'Поиск и быстрый переход к любому разделу'],
  ['Alt + 1…9', 'Переключение основных разделов'],
  ['Enter', 'Отправить сообщение (Shift+Enter — новая строка)'],
  ['↑ в пустом поле', 'Редактировать последнее своё сообщение'],
  ['Esc', 'Закрыть окно, отменить ответ или редактирование'],
  ['Двойной клик по сообщению', 'Ответить'],
  ['↑ / ↓ в Reels', 'Предыдущее / следующее видео'],
  ['← / → / пробел в историях', 'Навигация и пауза'],
  ['Ctrl + Enter', 'Опубликовать пост'],
];

export function ShortcutsSettings() {
  return (
    <SettingsPage title="Горячие клавиши" icon={<Keyboard size={22} />}>
      <Panel>
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="list-item">
            <span className="list-item__body">{d}</span>
            <span className="kbd">{k}</span>
          </div>
        ))}
      </Panel>
    </SettingsPage>
  );
}

export function AboutSettings() {
  return (
    <SettingsPage title={`О приложении ${APP_NAME}`} icon={<Info size={22} />}>
      <Panel>
        <div className="col gap-3" style={{ padding: 16 }}>
          <p>
            <b>{APP_NAME}</b> — всё общение под одним солнцем: чаты и звонки, каналы, лента, Reels, видео, компании и сообщества.
          </p>
          <p className="muted small">Версия 0.1.0 · React 19 + Fastify 5 + SQLite · PWA</p>
        </div>
      </Panel>
      <Panel title="Безопасность по умолчанию">
        {[
          'Пароли: scrypt с солью, проверка в постоянное время, блокировка перебора',
          'Сеансы: случайный токен в httpOnly SameSite=Strict cookie, в базе — только хэш',
          'CSRF: проверка Origin + токен, привязанный к сеансу',
          'Двухфакторная защита TOTP с защитой от повтора кода',
          'Секретные чаты: ECDH P-256 + AES-256-GCM, ключи только на устройстве',
          'Файлы: проверка типа по содержимому, подписанные ссылки, удаление EXIF',
          'Строгий Content-Security-Policy, HSTS, запрет встраивания во фреймы',
        ].map((t) => (
          <div key={t} className="list-item">
            <span className="list-item__body small">{t}</span>
          </div>
        ))}
      </Panel>
    </SettingsPage>
  );
}

interface Report {
  id: string;
  entityType: string;
  entityId: string;
  reason: ReportReason;
  details: string;
  createdAt: string;
}

export function AdminReports() {
  const list = useCursorList<Report>(['admin-reports'], '/admin/reports?status=open');
  const resolve = useMutation({
    mutationFn: (v: { id: string; status: 'resolved' | 'rejected'; removeContent: boolean }) => api.post(`/admin/reports/${v.id}`, v),
    onSuccess: () => void list.refetch(),
  });
  const items = flatPages(list.data);
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title="Модерация" subtitle="Открытые жалобы пользователей" icon={<Flag size={22} />} />
        {list.error ? <Notice kind="danger">Нет доступа: раздел только для модераторов</Notice> : null}
        {items.length === 0 && !list.isLoading && !list.error && <EmptyState icon={<Flag size={28} />} title="Жалоб нет" />}
        <div className="col gap-3">
          {items.map((r) => (
            <div key={r.id} className="card card--pad col gap-2">
              <div className="row between">
                <span className="tag tag--danger">{REPORT_REASON_LABELS[r.reason]}</span>
                <span className="xs faint">{fullDate(r.createdAt)}</span>
              </div>
              <div className="small">
                {r.entityType}:{' '}
                <Link to={r.entityType === 'post' ? `/post/${r.entityId}` : r.entityType === 'user' ? `/u/${r.entityId}` : '#'} className="mono">
                  {r.entityId}
                </Link>
              </div>
              {r.details && <p className="small muted">{r.details}</p>}
              <div className="row wrap">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    if (await confirm({ title: 'Удалить контент и закрыть жалобу?', danger: true, confirmLabel: 'Удалить' })) resolve.mutate({ id: r.id, status: 'resolved', removeContent: true });
                  }}
                >
                  Удалить контент
                </Button>
                <Button size="sm" variant="secondary" onClick={() => resolve.mutate({ id: r.id, status: 'rejected', removeContent: false })}>
                  Отклонить
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
