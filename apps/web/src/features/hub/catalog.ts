/**
 * Каталог «Орбиты» — сервисы, которые можно добавить в Sunnet.
 *
 * Как сервис работает внутри Sunnet, определяет `via`:
 *  - sunnet  — собственное приложение Sunnet (закрепляется в доке);
 *  - api     — официальный API/OAuth: данные приходят в Sunnet (чаты, уведомления);
 *  - web     — официальная веб-версия в отдельном окне. В браузере такие сайты
 *              запрещают встраивание (X-Frame-Options), поэтому открываются во
 *              вкладке; в приложении для компьютера — в изолированном окне;
 *  - link    — только ярлык на сайт сервиса.
 * Мы не имитируем доступ к чужим аккаунтам: где нет открытого API, есть только web/link.
 */
export type Via = 'sunnet' | 'api' | 'web' | 'link';

export type CatId = 'chat' | 'social' | 'music' | 'video' | 'work' | 'docs' | 'dev' | 'design' | 'games' | 'learn' | 'finance' | 'shop' | 'news' | 'travel' | 'health' | 'ai' | 'tools';

export const CATEGORIES: { id: CatId; label: string; emoji: string }[] = [
  { id: 'chat', label: 'Общение', emoji: '💬' },
  { id: 'social', label: 'Соцсети', emoji: '🌐' },
  { id: 'music', label: 'Музыка', emoji: '🎧' },
  { id: 'video', label: 'Кино и видео', emoji: '🎬' },
  { id: 'work', label: 'Работа', emoji: '💼' },
  { id: 'docs', label: 'Документы', emoji: '📄' },
  { id: 'dev', label: 'Разработка', emoji: '🧑‍💻' },
  { id: 'design', label: 'Дизайн', emoji: '🎨' },
  { id: 'games', label: 'Игры', emoji: '🎮' },
  { id: 'learn', label: 'Учёба', emoji: '📚' },
  { id: 'finance', label: 'Финансы', emoji: '💳' },
  { id: 'shop', label: 'Покупки', emoji: '🛍️' },
  { id: 'news', label: 'Новости', emoji: '📰' },
  { id: 'travel', label: 'Путешествия', emoji: '✈️' },
  { id: 'health', label: 'Здоровье', emoji: '🌿' },
  { id: 'ai', label: 'ИИ', emoji: '✨' },
  { id: 'tools', label: 'Утилиты', emoji: '🧰' },
];

export interface CatalogApp {
  id: string;
  name: string;
  cat: CatId;
  via: Via;
  url: string;
  publisher: string;
  verified: boolean;
  /** Популярность 0–100 — для сортировки и «Популярного» */
  pop: number;
  /** Чем сервис полезен — одна строка */
  blurb: string;
  /** Разрешения, которые понадобятся (каждое выдаётся отдельно) */
  perms: Perm[];
  color: string;
  isNew?: boolean;
}

export type Perm = 'files' | 'camera' | 'mic' | 'screen' | 'notify' | 'contacts' | 'location';
export const PERM_LABEL: Record<Perm, string> = {
  files: 'Файлы в своей папке облака',
  camera: 'Камера',
  mic: 'Микрофон',
  screen: 'Демонстрация экрана',
  notify: 'Уведомления',
  contacts: 'Контакты',
  location: 'Местоположение',
};

// Название | категория | способ | адрес | популярность | описание | разрешения (f c m s n k l)
const RAW = `
Telegram|chat|api|web.telegram.org|99|Чаты Telegram в общем списке Sunnet через официальный API|nf
WhatsApp|chat|web|web.whatsapp.com|99|Официальный WhatsApp Web в отдельном окне|nfcm
Viber|chat|link|viber.com|80|Ярлык на Viber|n
Discord|chat|web|discord.com/app|92|Серверы и голосовые каналы Discord|ncms
Slack|chat|api|app.slack.com|85|Каналы Slack: уведомления через официальный API|nf
Microsoft Teams|chat|web|teams.microsoft.com|82|Встречи и чаты Teams|ncms
Zoom|chat|web|app.zoom.us|86|Видеовстречи Zoom|cms
Skype|chat|link|web.skype.com|60|Ярлык на Skype|n
Signal|chat|link|signal.org|70|Ярлык на Signal (у Signal нет открытого API для клиентов)|
Snapchat|social|web|web.snapchat.com|84|Snapchat для компьютера|ncm
Instagram|social|web|instagram.com|98|Лента и директ Instagram|nf
Facebook|social|web|facebook.com|95|Лента и Messenger|nf
X (Twitter)|social|web|x.com|93|Лента X в окне Sunnet|n
Threads|social|web|threads.net|78|Обсуждения Threads|n
ВКонтакте|social|api|vk.com|94|Лента и сообщения VK через VK ID|nf
Одноклассники|social|web|ok.ru|72|Лента ОК|n
Reddit|social|api|reddit.com|83|Сообщества Reddit|n
Pinterest|social|web|pinterest.com|80|Идеи и доски|f
LinkedIn|social|web|linkedin.com|79|Профессиональная сеть|n
TikTok|social|web|tiktok.com|96|Короткие видео|n
Tumblr|social|web|tumblr.com|55|Блоги Tumblr|
Mastodon|social|api|joinmastodon.org|50|Децентрализованная соцсеть с открытым API|n
Bluesky|social|api|bsky.app|58|Открытый протокол AT|n
Яндекс Музыка|music|web|music.yandex.ru|93|Музыка и подкасты Яндекса|
Spotify|music|api|open.spotify.com|95|Плеер Spotify через Web Playback SDK (нужен Premium)|
Apple Music|music|web|music.apple.com|85|Apple Music в браузере|
VK Музыка|music|web|vk.com/music|82|Музыка ВКонтакте|
SoundCloud|music|api|soundcloud.com|74|Треки независимых авторов|
YouTube Music|music|web|music.youtube.com|88|Музыка YouTube|
Deezer|music|api|deezer.com|62|Каталог Deezer|
Звук|music|web|zvuk.com|70|Музыка и аудиокниги|
Bandcamp|music|link|bandcamp.com|45|Покупка музыки у артистов|
Last.fm|music|api|last.fm|40|Статистика прослушиваний|
Wink|video|web|wink.ru|85|Фильмы, сериалы и ТВ|
Кинопоиск|video|web|hd.kinopoisk.ru|92|Фильмы и сериалы Кинопоиска|
Okko|video|web|okko.tv|80|Онлайн-кинотеатр|
Иви|video|web|ivi.ru|78|Онлайн-кинотеатр|
START|video|web|start.ru|66|Сериалы START|
Premier|video|web|premier.one|60|Шоу и сериалы|
Netflix|video|web|netflix.com|94|Фильмы и сериалы Netflix|
YouTube|video|api|youtube.com|99|Видео: встраивание через официальный плеер|
Twitch|video|api|twitch.tv|86|Стримы Twitch|n
Rutube|video|web|rutube.ru|74|Видео Rutube|
VK Видео|video|web|vkvideo.ru|80|Видео ВКонтакте|
Disney+|video|web|disneyplus.com|80|Фильмы Disney|
Prime Video|video|web|primevideo.com|78|Amazon Prime Video|
Kick|video|web|kick.com|50|Стримы|
Notion|work|api|notion.so|90|Заметки и базы знаний|f
Trello|work|api|trello.com|80|Доски задач|n
Jira|work|api|atlassian.com/jira|78|Трекер задач|n
Asana|work|api|app.asana.com|65|Проекты и задачи|n
ClickUp|work|web|app.clickup.com|58|Всё для работы в одном месте|n
Яндекс Трекер|work|web|tracker.yandex.ru|55|Задачи команды|n
Miro|work|web|miro.com|78|Онлайн-доска|f
Todoist|work|api|todoist.com|70|Список дел|n
Google Календарь|work|api|calendar.google.com|90|Календарь и напоминания|n
Gmail|work|api|mail.google.com|97|Почта Gmail через официальный API|nf
Яндекс Почта|work|web|mail.yandex.ru|88|Почта Яндекса|n
Outlook|work|api|outlook.live.com|85|Почта и календарь Microsoft|n
Mail.ru Почта|work|web|e.mail.ru|80|Почта Mail.ru|n
Google Docs|docs|api|docs.google.com|95|Документы Google|f
Google Таблицы|docs|api|sheets.google.com|90|Таблицы Google|f
Google Диск|docs|api|drive.google.com|94|Файлы Google Диска|f
Яндекс Диск|docs|api|disk.yandex.ru|86|Облако Яндекса|f
Яндекс Документы|docs|web|docs.yandex.ru|65|Документы в Яндекс 360|f
Dropbox|docs|api|dropbox.com|80|Облачное хранилище|f
OneDrive|docs|api|onedrive.live.com|82|Облако Microsoft|f
Microsoft 365|docs|web|office.com|90|Word, Excel, PowerPoint онлайн|f
Smallpdf|docs|link|smallpdf.com|60|Инструменты PDF|f
iLovePDF|docs|link|ilovepdf.com|62|Объединение и сжатие PDF|f
GitHub|dev|api|github.com|92|Репозитории, задачи и ревью|nf
GitLab|dev|api|gitlab.com|70|Репозитории и CI|n
CodeSandbox|dev|web|codesandbox.io|60|Песочница для кода|
StackBlitz|dev|web|stackblitz.com|58|Веб-IDE|
Replit|dev|web|replit.com|65|Код в браузере|
Stack Overflow|dev|link|stackoverflow.com|85|Ответы программистам|
Render|dev|link|dashboard.render.com|55|Хостинг серверов (для своих серверов Sunnet)|
Vercel|dev|link|vercel.com|60|Хостинг сайтов|
Supabase|dev|link|supabase.com|55|База данных и авторизация|
Figma|design|web|figma.com|92|Дизайн интерфейсов|f
Canva|design|web|canva.com|90|Дизайн за минуты|f
Photopea|design|web|photopea.com|70|Редактор фото в браузере|f
Adobe Express|design|web|express.adobe.com|65|Быстрый дизайн от Adobe|f
Dribbble|design|link|dribbble.com|55|Вдохновение для дизайнеров|
Behance|design|link|behance.net|58|Портфолио|
Unsplash|design|api|unsplash.com|70|Бесплатные фото|f
Steam|games|link|store.steampowered.com|96|Магазин игр Steam|
Epic Games|games|link|store.epicgames.com|85|Магазин Epic|
Xbox Cloud Gaming|games|web|xbox.com/play|70|Облачный гейминг|
GeForce NOW|games|web|play.geforcenow.com|72|Облачный гейминг NVIDIA|
Chess.com|games|web|chess.com|75|Шахматы онлайн|
Lichess|games|web|lichess.org|65|Бесплатные шахматы|
itch.io|games|link|itch.io|55|Инди-игры|
Roblox|games|link|roblox.com|90|Ярлык на Roblox|
Duolingo|learn|web|duolingo.com|88|Иностранные языки|n
Coursera|learn|web|coursera.org|70|Онлайн-курсы|
Stepik|learn|web|stepik.org|65|Курсы по программированию|
Khan Academy|learn|web|khanacademy.org|65|Бесплатное обучение|
Википедия|learn|api|wikipedia.org|95|Свободная энциклопедия|
Учи.ру|learn|web|uchi.ru|60|Для школьников|
Яндекс Учебник|learn|web|education.yandex.ru|50|Школьная программа|
Т-Банк|finance|link|tbank.ru|90|Ярлык на банк|
Сбербанк Онлайн|finance|link|online.sberbank.ru|92|Ярлык на банк|
Альфа-Банк|finance|link|alfabank.ru|80|Ярлык на банк|
PayPal|finance|link|paypal.com|80|Платежи|
Дзен-мани|finance|web|zenmoney.ru|50|Учёт расходов|
TradingView|finance|web|tradingview.com|70|Графики рынков|
Ozon|shop|web|ozon.ru|95|Маркетплейс|n
Wildberries|shop|web|wildberries.ru|96|Маркетплейс|n
Яндекс Маркет|shop|web|market.yandex.ru|85|Маркетплейс|n
Авито|shop|web|avito.ru|90|Объявления|n
AliExpress|shop|web|aliexpress.ru|85|Товары из Китая|n
Самокат|shop|link|samokat.ru|70|Доставка продуктов|
Купер|shop|link|kuper.ru|65|Доставка из магазинов|
Lamoda|shop|web|lamoda.ru|72|Одежда и обувь|
Amazon|shop|web|amazon.com|90|Маркетплейс|
Яндекс Новости|news|web|dzen.ru/news|80|Главное за день|
Дзен|news|web|dzen.ru|82|Статьи и видео|
Хабр|news|web|habr.com|78|Технологии и разработка|
Meduza|news|link|meduza.io|60|Новости|
RSS-ридер Sunnet|news|sunnet|/orbit|50|Любимые сайты одной лентой|
Google Новости|news|web|news.google.com|70|Новости со всего мира|
Яндекс Карты|travel|web|yandex.ru/maps|94|Карты и маршруты|l
Google Карты|travel|web|google.com/maps|92|Карты и маршруты|l
2ГИС|travel|web|2gis.ru|85|Город и организации|l
Яндекс Go|travel|link|go.yandex|85|Такси и доставка|l
Туту|travel|web|tutu.ru|65|Билеты на поезда|
Aviasales|travel|web|aviasales.ru|80|Дешёвые авиабилеты|
Booking.com|travel|web|booking.com|85|Отели|
Островок|travel|web|ostrovok.ru|60|Отели|
Airbnb|travel|web|airbnb.com|80|Жильё|
Strava|health|api|strava.com|65|Пробежки и велосипед|l
Госуслуги|tools|link|gosuslugi.ru|95|Ярлык на Госуслуги|
Calm|health|web|calm.com|50|Медитации|
Headspace|health|web|headspace.com|50|Осознанность|
ChatGPT|ai|web|chatgpt.com|97|Чат с ИИ|f
Claude|ai|web|claude.ai|85|ИИ-ассистент|f
GigaChat|ai|web|giga.chat|70|ИИ от Сбера|f
Алиса|ai|web|alice.yandex.ru|80|Ассистент Яндекса|m
Perplexity|ai|web|perplexity.ai|70|Поиск с ИИ|
Midjourney|ai|web|midjourney.com|72|Генерация изображений|f
Шедеврум|ai|web|shedevrum.ai|55|Картинки по описанию|f
DeepL|ai|web|deepl.com|75|Переводчик|f
Google Переводчик|tools|web|translate.google.com|90|Переводчик|
Яндекс Переводчик|tools|web|translate.yandex.ru|85|Переводчик|
Speedtest|tools|web|speedtest.net|70|Скорость интернета|
Bitwarden|tools|web|vault.bitwarden.com|60|Менеджер паролей|
Excalidraw|design|web|excalidraw.com|65|Рисованные схемы|f
draw.io|design|web|app.diagrams.net|65|Диаграммы|f
Погода Sunnet|tools|sunnet|/orbit|60|Прогноз на рабочем столе|l
Заметки Sunnet|docs|sunnet|/orbit|70|Заметки в облаке Sunnet|f
Калькулятор Sunnet|tools|sunnet|/orbit|60|Калькулятор и конвертер|
Студия Sunnet|dev|sunnet|/studio|90|Создавайте свои приложения и серверы|f
Sunnet Connect|dev|sunnet|/connect|70|Свой компьютер как сервер Sunnet|n
Браузер Sunnet|tools|sunnet|/browser|95|Вкладки, закладки и загрузки в облако|fn
`;

const PALETTE = ['#2f80ed', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#00b8d9', '#f2c94c', '#ff6b9a', '#56ccf2', '#6fcf97', '#bb6bd9', '#ff8f3d'];
const PERM_CODE: Record<string, Perm> = { f: 'files', c: 'camera', m: 'mic', s: 'screen', n: 'notify', k: 'contacts', l: 'location' };

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
}

export const CATALOG: CatalogApp[] = RAW.trim()
  .split('\n')
  .map((line, i) => {
    const [name, cat, via, url, pop, blurb, perms = ''] = line.split('|');
    const own = via === 'sunnet';
    return {
      id: slug(name!),
      name: name!,
      cat: cat as CatId,
      via: via as Via,
      url: own ? url! : `https://${url}`,
      publisher: own ? 'Sunnet' : name!.split(' ')[0]!,
      verified: own || Number(pop) >= 60,
      pop: Number(pop),
      blurb: blurb!,
      perms: [...perms].map((c) => PERM_CODE[c]).filter((p): p is Perm => !!p),
      color: PALETTE[i % PALETTE.length]!,
      isNew: i % 11 === 3,
    };
  });

export const catalogById = new Map(CATALOG.map((a) => [a.id, a]));

export const VIA_LABEL: Record<Via, string> = {
  sunnet: 'Приложение Sunnet',
  api: 'Официальный API',
  web: 'Веб-версия сервиса',
  link: 'Ярлык на сайт',
};
