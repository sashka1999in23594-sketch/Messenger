import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Accessibility, Bell, Database, Flag, Info, Keyboard, Languages, LayoutGrid, MessageCircle, Palette, Settings, Type, Zap } from 'lucide-react';
import { APP_NAME, REPORT_REASON_LABELS, type ReportReason } from '@omni/shared';
import { sections } from '../../app/navigation';
import { api } from '../../shared/api/client';
import { flatPages, queryClient, useCursorList } from '../../shared/api/query';
import { applyPrefs, usePrefs, type Accent, type Theme } from '../../shared/stores/prefs';
import { toast } from '../../shared/stores/ui';
import { fileSize, fullDate } from '../../shared/lib/format';
import { Button, confirm, EmptyState, Notice, PageHeader, SettingRow, Switch } from '../../shared/ui';
import { Panel, SettingsPage, useNotificationPrefs } from './common';

export function SettingsHome() {
  const settings = sections.find((s) => s.id === 'settings')!;
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Настройки" subtitle="Всё, что можно настроить в Omni. Подсказка: Ctrl+K найдёт любую настройку по названию" icon={<Settings size={22} />} />
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
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const rows: [keyof typeof prefs, string, string][] = [
    ['messages', 'Сообщения', 'Всплывающие уведомления о новых сообщениях'],
    ['mentions', 'Упоминания', 'Когда вас отмечают через @'],
    ['replies', 'Ответы и комментарии', 'К вашим публикациям и комментариям'],
    ['likes', 'Отметки «Нравится»', ''],
    ['reposts', 'Репосты и цитаты', ''],
    ['follows', 'Новые подписчики', 'И заявки на подписку'],
    ['communities', 'Сообщества', 'Новые участники ваших сообществ'],
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
      <Panel title="Уведомления браузера" footer="Push-уведомления при закрытой вкладке появятся вместе с Web Push (в плане развития).">
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

const ACCENTS: { id: Accent; color: string; label: string }[] = [
  { id: 'violet', color: '#6c5ce7', label: 'Фиолетовый' },
  { id: 'blue', color: '#2f80ed', label: 'Синий' },
  { id: 'green', color: '#10a37f', label: 'Зелёный' },
  { id: 'orange', color: '#f2711c', label: 'Оранжевый' },
  { id: 'pink', color: '#e64980', label: 'Розовый' },
  { id: 'teal', color: '#0ea5b7', label: 'Бирюзовый' },
];

export function AppearanceSettings({ section }: { section: 'theme' | 'accent' | 'text' | 'density' }) {
  const prefs = usePrefs();
  const update = (patch: Parameters<typeof prefs.set>[0]) => {
    prefs.set(patch);
    applyPrefs({ ...prefs, ...patch });
  };
  const preview = (bg: string, side: string, line: string) => (
    <span className="theme-card__preview" style={{ background: bg }}>
      <span style={{ background: side }} />
      <span style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ height: 6, borderRadius: 3, background: line, width: '70%' }} />
        <span style={{ height: 6, borderRadius: 3, background: 'var(--accent)', width: '50%', alignSelf: 'flex-end' }} />
        <span style={{ height: 6, borderRadius: 3, background: line, width: '60%' }} />
      </span>
    </span>
  );
  return (
    <SettingsPage title="Оформление" subtitle="Настройки хранятся на этом устройстве" icon={<Palette size={22} />}>
      {section === 'theme' && (
        <Panel title="Тема">
          <div className="theme-cards">
            {(
              [
                ['system', 'Как в системе', preview('linear-gradient(90deg,#f4f5fa 50%,#0b0d14 50%)', '#ccc', '#888')],
                ['light', 'Светлая', preview('#f4f5fa', '#fff', '#d5d8e3')],
                ['dark', 'Тёмная', preview('#0b0d14', '#11141e', '#2a3042')],
              ] as [Theme, string, React.ReactNode][]
            ).map(([id, label, pv]) => (
              <button key={id} className="theme-card" aria-pressed={prefs.theme === id} onClick={() => update({ theme: id })}>
                {pv}
                {label}
              </button>
            ))}
          </div>
        </Panel>
      )}
      {section === 'accent' && (
        <Panel title="Цвет акцента">
          <div className="accent-swatches">
            {ACCENTS.map((a) => (
              <button key={a.id} className="accent-swatch" style={{ background: a.color }} aria-pressed={prefs.accent === a.id} aria-label={a.label} title={a.label} onClick={() => update({ accent: a.id })} />
            ))}
          </div>
        </Panel>
      )}
      {section === 'text' && (
        <Panel title="Размер текста" footer="Пример: так будут выглядеть сообщения и публикации.">
          <div className="col gap-3" style={{ padding: 16 }}>
            <input type="range" min={0.85} max={1.3} step={0.05} value={prefs.fontScale} onChange={(e) => update({ fontScale: Number(e.target.value) })} aria-label="Масштаб текста" />
            <div className="row between small muted">
              <span>Мельче</span>
              <span>{Math.round(prefs.fontScale * 100)}%</span>
              <span>Крупнее</span>
            </div>
            <div className="bubble" style={{ alignSelf: 'flex-start' }}>
              Привет! Так выглядит текст в Omni 👋
            </div>
          </div>
        </Panel>
      )}
      {section === 'density' && (
        <Panel title="Плотность интерфейса">
          <SettingRow
            title="Компактный режим"
            description="Меньше отступов — больше информации на экране"
            control={<Switch checked={prefs.density === 'compact'} onChange={(v) => update({ density: v ? 'compact' : 'comfortable' })} label="Компактный режим" />}
          />
        </Panel>
      )}
      <Panel title="Другие настройки оформления">
        {(
          [
            ['theme', 'Тема', Palette],
            ['accent', 'Цвет акцента', Palette],
            ['text', 'Размер текста', Type],
            ['density', 'Плотность', LayoutGrid],
          ] as const
        )
          .filter(([id]) => id !== section)
          .map(([id, label, Icon]) => (
            <Link key={id} to={`/settings/appearance/${id}`} className="list-item">
              <span className="list-item__icon">
                <Icon size={18} />
              </span>
              <span className="list-item__body">{label}</span>
            </Link>
          ))}
      </Panel>
    </SettingsPage>
  );
}

export function ChatSettings({ section }: { section: 'input' | 'media' }) {
  const prefs = usePrefs();
  return section === 'input' ? (
    <SettingsPage title="Отправка сообщений" icon={<Keyboard size={22} />}>
      <Panel footer="На телефоне Enter всегда переносит строку — отправка кнопкой.">
        <SettingRow title="Отправлять по Enter" description="Shift+Enter — новая строка" control={<Switch checked={prefs.enterToSend} onChange={(v) => prefs.set({ enterToSend: v })} label="Enter" />} />
      </Panel>
    </SettingsPage>
  ) : (
    <SettingsPage title="Медиа и трафик" icon={<MessageCircle size={22} />}>
      <Panel>
        <SettingRow title="Автовоспроизведение видео" description="Клипы и истории запускаются сами" control={<Switch checked={prefs.autoplayVideo} onChange={(v) => prefs.set({ autoplayVideo: v })} label="Автовоспроизведение" />} />
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
      <Panel footer="Английский и другие языки появятся вместе с системой локализации (в плане развития).">
        <label className="list-item audience__option">
          <input type="radio" checked readOnly /> <span className="list-item__body">Русский</span>
        </label>
        <label className="list-item audience__option" style={{ opacity: 0.5 }}>
          <input type="radio" disabled /> <span className="list-item__body">English — скоро</span>
        </label>
      </Panel>
    </SettingsPage>
  );
}

export function AccessibilitySettings() {
  const prefs = usePrefs();
  const update = (patch: Parameters<typeof prefs.set>[0]) => {
    prefs.set(patch);
    applyPrefs({ ...prefs, ...patch });
  };
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
  ['↑ / ↓ в клипах', 'Предыдущий / следующий клип'],
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
            <b>{APP_NAME}</b> — прототип платформы «всё в одном»: мессенджер, лента, видео, клипы, фото, истории и сообщества.
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

export function ServicesHome() {
  const s = sections.find((x) => x.id === 'services')!;
  return (
    <div className="scroll">
      <div className="page page--wide">
        <PageHeader title="Сервисы" subtitle="Модули, которые встраиваются в ту же архитектуру: их место в навигации уже готово" icon={<Zap size={22} />} />
        <div className="settings-grid">
          {s.children.map((n) => {
            const Icon = n.icon ?? Zap;
            return (
              <Link key={n.id} to={n.path!} className="settings-tile">
                <span className="row" style={{ gap: 10 }}>
                  <span className="list-item__icon">
                    <Icon size={18} />
                  </span>
                  <span className="bold">{n.label}</span>
                  <span className="tree__soon" style={{ marginLeft: 'auto' }}>
                    скоро
                  </span>
                </span>
                <span className="small muted">{n.planned?.join(' · ')}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
