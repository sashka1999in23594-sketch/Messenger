/**
 * Поиск по настройкам: разделы из реестра навигации + отдельные переключатели
 * (чтобы «звук отправки» находил нужную страницу, даже если такого раздела нет).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CornerDownLeft, Search, Settings, SlidersHorizontal } from 'lucide-react';
import { flatNodes } from '../../app/navigation';

interface Entry {
  title: string;
  path: string;
  where: string;
  keywords: string;
}

/** Отдельные настройки внутри страниц */
const ITEMS: [title: string, path: string, where: string, keywords?: string][] = [
  ['Тёмная и светлая тема', '/settings/appearance/theme', 'Оформление', 'ночь день система'],
  ['Режим «Пространство»', '/settings/space', 'Пространство', 'окна рабочий стол масштаб колесо'],
  ['Палитра «северного сияния»', '/settings/appearance/theme', 'Оформление', 'закат океан лес сакура'],
  ['Цвет акцента', '/settings/appearance/accent', 'Оформление', 'цвет кнопок'],
  ['Матовое стекло', '/settings/power', 'Энергосбережение', 'прозрачность размытие blur'],
  ['Анимации и сияние', '/settings/power', 'Энергосбережение', 'движение фон aurora'],
  ['Режим экономии', '/settings/power', 'Энергосбережение', 'батарея слабый телефон'],
  ['Размер текста интерфейса', '/settings/appearance/text', 'Оформление', 'масштаб шрифт крупнее'],
  ['Шрифт интерфейса', '/settings/appearance/font', 'Оформление', 'inter системный округлый засечки моно'],
  ['Скругление углов', '/settings/appearance/font', 'Оформление', 'радиус углы'],
  ['Плотность интерфейса', '/settings/appearance/density', 'Оформление', 'компактно'],
  ['Обои чатов', '/settings/chats/wallpaper', 'Чаты', 'фон переписки звёзды закат'],
  ['Размер текста сообщений', '/settings/chats/wallpaper', 'Чаты', 'шрифт пузыри'],
  ['Отправка по Enter', '/settings/behavior', 'Поведение', 'shift enter перенос'],
  ['Проверка орфографии', '/settings/behavior', 'Поведение', 'ошибки подчёркивание'],
  ['Крупные эмодзи', '/settings/behavior', 'Поведение', 'смайлики большие'],
  ['Стартовая страница', '/settings/behavior', 'Поведение', 'главная при запуске открывать'],
  ['Автовоспроизведение видео', '/settings/chats/media', 'Чаты', 'автозапуск кометы'],
  ['Экономия трафика', '/settings/chats/media', 'Чаты', 'мобильный интернет'],
  ['Громкость звуков', '/settings/notifications/sounds', 'Уведомления', 'тише громче'],
  ['Звук отправки сообщения', '/settings/notifications/sounds', 'Уведомления', 'щелчок'],
  ['Мелодия звонка', '/settings/notifications/sounds', 'Уведомления', 'рингтон'],
  ['Тихие часы', '/settings/notifications/quiet', 'Уведомления', 'не беспокоить ночь расписание'],
  ['Уведомления на рабочем столе', '/settings/notifications/quiet', 'Уведомления', 'браузер системные push'],
  ['Показывать текст в уведомлениях', '/settings/notifications', 'Уведомления', 'превью'],
  ['Уведомления о новых публикациях', '/settings/notifications', 'Уведомления', 'колокольчик подписки'],
  ['Закрытый профиль', '/settings/privacy/profile', 'Приватность', 'приватный аккаунт заявки'],
  ['Показывать в поиске', '/settings/privacy/profile', 'Приватность', 'найти меня'],
  ['Отчёты о прочтении', '/settings/privacy/last-seen', 'Приватность', 'галочки прочитано'],
  ['Кто видит, когда я в сети', '/settings/privacy/last-seen', 'Приватность', 'онлайн был недавно'],
  ['Кто может писать мне', '/settings/privacy/messages', 'Приватность', 'сообщения спам'],
  ['Кто может комментировать', '/settings/privacy/interactions', 'Приватность', 'комментарии'],
  ['Отметки и упоминания', '/settings/privacy/interactions', 'Приватность', 'теги'],
  ['Близкие друзья', '/settings/privacy/close-friends', 'Приватность', 'истории зелёный'],
  ['Скрытые слова', '/settings/privacy/muted-words', 'Приватность', 'фильтр спойлеры'],
  ['Чёрный список', '/settings/privacy/blocked', 'Приватность', 'заблокированные'],
  ['Пароль', '/settings/security/password', 'Безопасность', 'сменить пароль'],
  ['Приложение-аутентификатор', '/settings/security/2fa', 'Безопасность', '2fa totp google authenticator'],
  ['Код из письма при входе', '/settings/security/2fa', 'Безопасность', 'почта 2fa'],
  ['Резервные коды', '/settings/security/2fa', 'Безопасность', 'восстановление'],
  ['Активные сеансы', '/settings/security/sessions', 'Безопасность', 'устройства выйти везде'],
  ['Код-пароль приложения', '/settings/security/passcode', 'Безопасность', 'блокировка pin'],
  ['Ключи шифрования', '/settings/security/keys', 'Безопасность', 'секретные чаты e2e'],
  ['Журнал входов', '/settings/security/log', 'Безопасность', 'история входов'],
  ['Почта', '/settings/account/email', 'Аккаунт', 'email подтвердить письма'],
  ['Имя пользователя', '/settings/account/username', 'Аккаунт', 'username логин'],
  ['Статус', '/settings/account/profile', 'Аккаунт', 'эмодзи занят отпуск'],
  ['Ссылки в профиле', '/settings/account/profile', 'Аккаунт', 'сайт github'],
  ['Экспорт данных', '/settings/account/export', 'Аккаунт', 'скачать архив'],
  ['Удалить аккаунт', '/settings/account/delete', 'Аккаунт', 'удаление'],
  ['Очистить кэш', '/settings/data', 'Данные', 'память место'],
  ['Горячие клавиши', '/settings/shortcuts', 'Прочее', 'клавиатура ctrl k'],
];

function buildIndex(): Entry[] {
  const fromNav = flatNodes
    .filter((f) => f.section.id === 'settings' && f.node.path && f.node.path !== '/settings' && !f.node.adminOnly)
    .map((f) => ({
      title: f.node.label,
      path: f.node.path!,
      where: ['Настройки', ...f.trail.slice(1).map((t) => t.label)].join(' › '),
      keywords: (f.node.keywords ?? []).join(' '),
    }));
  const items = ITEMS.map(([title, path, where, keywords = '']) => ({ title, path, where, keywords }));
  return [...fromNav, ...items];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export function SettingsSearch({ onActive }: { onActive: (active: boolean) => void }) {
  const [q, setQ] = useState('');
  const index = useMemo(buildIndex, []);
  const results = useMemo(() => {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = index
      .map((e) => {
        const title = norm(e.title);
        const hay = `${title} ${norm(e.where)} ${norm(e.keywords)}`;
        if (!terms.every((t) => hay.includes(t))) return null;
        const score = terms.reduce((s, t) => s + (title.startsWith(t) ? 3 : title.includes(t) ? 2 : 1), 0);
        return { e, score };
      })
      .filter((x): x is { e: Entry; score: number } => !!x)
      .sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    return scored.filter(({ e }) => !seen.has(e.title + e.path) && seen.add(e.title + e.path)).slice(0, 12);
  }, [q, index]);

  return (
    <>
      <div className="settings-search">
        <Search size={20} className="settings-search__icon" />
        <input
          className="input"
          type="search"
          placeholder="Поиск настроек: «звук», «пароль», «обои»…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onActive(!!e.target.value.trim());
          }}
          aria-label="Поиск настроек"
          autoFocus={!matchMedia('(pointer: coarse)').matches}
        />
      </div>
      {q.trim() && (
        <div className="panel" style={{ padding: 6, marginBottom: 20 }}>
          {results.length ? (
            <div className="settings-results">
              {results.map(({ e }) => (
                <Link key={e.title + e.path} to={e.path} className="settings-result">
                  <span className="list-item__icon">
                    <SlidersHorizontal size={16} />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <b>{e.title}</b>
                    <span className="settings-result__path" style={{ display: 'block' }}>
                      {e.where}
                    </span>
                  </span>
                  <CornerDownLeft size={14} className="faint" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="row gap-2 muted" style={{ padding: 14 }}>
              <Settings size={16} /> Ничего не нашлось — попробуйте другое слово
            </div>
          )}
        </div>
      )}
    </>
  );
}
