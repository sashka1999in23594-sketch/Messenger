/**
 * Реестр навигации — единый источник правды о структуре приложения.
 * Из него строятся: рельс разделов, дерево подразделов, хлебные крошки,
 * командная палитра (Ctrl+K), мобильные вкладки и страницы «скоро».
 *
 * Добавить раздел = добавить узел сюда (+ маршрут в routes.tsx, если он
 * уже реализован). Узел с `planned` автоматически получает страницу-дорожную
 * карту, поэтому структура может опережать реализацию.
 */
import {
  Accessibility,
  LayoutDashboard,
  House,
  BatteryCharging,
  Gauge,
  Moon,
  Volume2,
  Archive,
  AtSign,
  Bell,
  Bookmark,
  Bot,
  Brain,
  Calendar,
  Camera,
  ChartColumn,
  CircleUser,
  Clapperboard,
  Clock,
  Cloud,
  Compass,
  Database,
  Download,
  Eye,
  Fingerprint,
  Flag,
  Flame,
  Gamepad2,
  Hash,
  Heart,
  History,
  Image,
  ImagePlus,
  Inbox,
  Info,
  KeyRound,
  Keyboard,
  Languages,
  LayoutGrid,
  ListVideo,
  Lock,
  type LucideIcon,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Mic,
  Music,
  Newspaper,
  Palette,
  PenLine,
  Phone,
  PhoneMissed,
  Plus,
  Radio,
  Repeat2,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  SquarePlay,
  Star,
  Store,
  Ticket,
  Timer,
  TrendingUp,
  Trash2,
  Tv,
  Type,
  Upload,
  User,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  UsersRound,
  VolumeX,
  Wallet,
  Wand2,
  Zap,
} from 'lucide-react';

export interface NavNode {
  id: string;
  label: string;
  icon?: LucideIcon;
  path?: string;
  children?: NavNode[];
  /** Функция в разработке: список того, что в неё войдёт */
  planned?: string[];
  description?: string;
  keywords?: string[];
  badge?: 'chats' | 'notifications' | 'requests';
  adminOnly?: boolean;
}

export interface NavSection extends NavNode {
  icon: LucideIcon;
  path: string;
  short: string;
  children: NavNode[];
}

export const sections: NavSection[] = [
  {
    id: 'home',
    label: 'Главная',
    short: 'Главная',
    icon: House,
    path: '/home',
    description: 'Сводка: непрочитанное, уведомления, звонки и запланированное',
    children: [
      { id: 'home.overview', label: 'Сводка', icon: LayoutDashboard, path: '/home', keywords: ['главная', 'дашборд', 'сегодня'] },
      { id: 'home.whatsnew', label: 'Что нового', icon: Sparkles, path: '/home/whats-new', keywords: ['обновления', 'новые функции'] },
    ],
  },
  {
    id: 'messenger',
    label: 'Мессенджер',
    short: 'Чаты',
    icon: MessageCircle,
    path: '/chats',
    badge: 'chats',
    description: 'Личные переписки, группы, каналы и секретные чаты',
    children: [
      { id: 'messenger.all', label: 'Все чаты', icon: MessagesSquare, path: '/chats', keywords: ['сообщения', 'переписка'] },
      {
        id: 'messenger.folders',
        label: 'Папки',
        icon: Inbox,
        children: [
          { id: 'messenger.folders.unread', label: 'Непрочитанные', icon: Bell, path: '/chats/folder/unread' },
          { id: 'messenger.folders.direct', label: 'Личные', icon: User, path: '/chats/folder/direct' },
          { id: 'messenger.folders.groups', label: 'Группы', icon: Users, path: '/chats/folder/groups' },
          { id: 'messenger.folders.channels', label: 'Каналы', icon: Megaphone, path: '/chats/folder/channels' },
          { id: 'messenger.folders.archived', label: 'Архив', icon: Archive, path: '/chats/folder/archived' },
          { id: 'messenger.folders.custom', label: 'Свои папки', icon: Plus, path: '/chats/folders', keywords: ['папка', 'фильтр', 'сортировка'] },
        ],
      },
      { id: 'messenger.secret', label: 'Секретные чаты', icon: Lock, path: '/chats/folder/secret', keywords: ['e2e', 'шифрование'] },
      { id: 'messenger.saved', label: 'Избранное', icon: Bookmark, path: '/chats/saved', keywords: ['заметки', 'saved'] },
      {
        id: 'messenger.create',
        label: 'Создать',
        icon: Plus,
        children: [
          { id: 'messenger.create.direct', label: 'Новый чат', icon: MessageCircle, path: '/chats/new/direct' },
          { id: 'messenger.create.group', label: 'Новая группа', icon: Users, path: '/chats/new/group' },
          { id: 'messenger.create.channel', label: 'Новый канал', icon: Megaphone, path: '/chats/new/channel' },
          { id: 'messenger.create.secret', label: 'Секретный чат', icon: Lock, path: '/chats/new/secret' },
        ],
      },
      { id: 'messenger.discover', label: 'Каталог каналов', icon: Compass, path: '/chats/discover', keywords: ['поиск каналов'] },
      {
        id: 'messenger.contacts',
        label: 'Контакты',
        icon: UsersRound,
        children: [
          { id: 'messenger.contacts.following', label: 'Мои подписки', icon: UserCheck, path: '/contacts/following' },
          { id: 'messenger.contacts.followers', label: 'Подписчики', icon: Users, path: '/contacts/followers' },
          { id: 'messenger.contacts.suggestions', label: 'Возможно, знакомы', icon: UserPlus, path: '/contacts/suggestions' },
        ],
      },
      {
        id: 'messenger.calls',
        label: 'Звонки',
        icon: Phone,
        children: [
          { id: 'messenger.calls.recent', label: 'Недавние', icon: Phone, path: '/calls', keywords: ['звонок', 'видеозвонок', 'webrtc'] },
          { id: 'messenger.calls.missed', label: 'Пропущенные', icon: PhoneMissed, path: '/calls/missed' },
          {
            id: 'messenger.calls.group',
            label: 'Конференции',
            icon: Users,
            path: '/calls/group',
            planned: ['Групповые звонки до 50 человек', 'Демонстрация экрана', 'Запись разговора'],
          },
        ],
      },
      {
        id: 'messenger.bots',
        label: 'Боты',
        icon: Bot,
        path: '/chats/bots',
        planned: ['Bot API с токенами и вебхуками', 'Inline-кнопки', 'Мини-приложения внутри чатов'],
      },
    ],
  },
  {
    id: 'feed',
    label: 'Лента',
    short: 'Лента',
    icon: Newspaper,
    path: '/feed',
    description: 'Короткие посты, обсуждения и тренды',
    children: [
      { id: 'feed.foryou', label: 'Для вас', icon: Sparkles, path: '/feed', keywords: ['рекомендации'] },
      { id: 'feed.following', label: 'Подписки', icon: UserCheck, path: '/feed/following' },
      { id: 'feed.latest', label: 'Свежее', icon: Clock, path: '/feed/latest' },
      { id: 'feed.trending', label: 'Популярное', icon: Flame, path: '/feed/trending' },
      {
        id: 'feed.topics',
        label: 'Темы',
        icon: Hash,
        children: [
          { id: 'feed.topics.hashtags', label: 'Хэштеги', icon: Hash, path: '/feed/hashtags' },
          { id: 'feed.topics.lists', label: 'Списки', icon: ScrollText, path: '/feed/lists', keywords: ['списки авторов', 'лента списка'] },
        ],
      },
      {
        id: 'feed.mine',
        label: 'Моё',
        icon: User,
        children: [
          { id: 'feed.mine.compose', label: 'Написать пост', icon: PenLine, path: '/feed/compose' },
          { id: 'feed.mine.bookmarks', label: 'Закладки и коллекции', icon: Bookmark, path: '/feed/bookmarks', keywords: ['коллекции', 'сохранённое'] },
          { id: 'feed.mine.liked', label: 'Понравилось', icon: Heart, path: '/feed/liked' },
          { id: 'feed.mine.drafts', label: 'Черновики', icon: PenLine, path: '/feed/drafts' },
          { id: 'feed.mine.scheduled', label: 'Запланированные', icon: Calendar, path: '/feed/scheduled', keywords: ['отложенные', 'расписание'] },
        ],
      },
    ],
  },
  {
    id: 'video',
    label: 'Видео',
    short: 'Видео',
    icon: SquarePlay,
    path: '/video',
    description: 'Длинные видео, плейлисты и студия автора',
    children: [
      { id: 'video.home', label: 'Главная', icon: LayoutGrid, path: '/video' },
      { id: 'video.subscriptions', label: 'Подписки', icon: UserCheck, path: '/video/subscriptions' },
      { id: 'video.trending', label: 'В тренде', icon: TrendingUp, path: '/video/trending' },
      {
        id: 'video.library',
        label: 'Библиотека',
        icon: ListVideo,
        children: [
          { id: 'video.library.history', label: 'История', icon: History, path: '/video/history' },
          { id: 'video.library.later', label: 'Смотреть позже', icon: Clock, path: '/video/watch-later' },
          { id: 'video.library.liked', label: 'Понравившиеся', icon: Heart, path: '/video/liked' },
          { id: 'video.library.playlists', label: 'Плейлисты', icon: ListVideo, path: '/video/playlists' },
        ],
      },
      {
        id: 'video.studio',
        label: 'Студия',
        icon: Tv,
        children: [
          { id: 'video.studio.dashboard', label: 'Панель автора', icon: ChartColumn, path: '/video/studio' },
          { id: 'video.studio.content', label: 'Мой контент', icon: Clapperboard, path: '/video/studio/content' },
          { id: 'video.studio.upload', label: 'Загрузить видео', icon: Upload, path: '/video/upload' },
          {
            id: 'video.studio.monetization',
            label: 'Монетизация',
            icon: Wallet,
            path: '/video/studio/monetization',
            planned: ['Платные подписки', 'Донаты', 'Партнёрская программа'],
          },
          { id: 'video.studio.subtitles', label: 'Субтитры', icon: Type, path: '/video/studio/subtitles', planned: ['Автоматические субтитры', 'Перевод на другие языки'] },
        ],
      },
      { id: 'video.live', label: 'Прямые эфиры', icon: Radio, path: '/video/live', planned: ['Трансляции с камеры и экрана', 'Чат эфира', 'Запись эфира'] },
    ],
  },
  {
    id: 'shorts',
    label: 'Клипы',
    short: 'Клипы',
    icon: Clapperboard,
    path: '/shorts',
    description: 'Короткие вертикальные видео',
    children: [
      { id: 'shorts.foryou', label: 'Рекомендации', icon: Sparkles, path: '/shorts' },
      { id: 'shorts.following', label: 'Подписки', icon: UserCheck, path: '/shorts/following' },
      { id: 'shorts.trending', label: 'Популярные', icon: Flame, path: '/shorts/trending' },
      { id: 'shorts.create', label: 'Снять клип', icon: Plus, path: '/shorts/create' },
      { id: 'shorts.mine', label: 'Мои клипы', icon: User, path: '/shorts/mine' },
      {
        id: 'shorts.tools',
        label: 'Инструменты',
        icon: Wand2,
        children: [
          { id: 'shorts.tools.sounds', label: 'Звуки', icon: Music, path: '/shorts/sounds', planned: ['Библиотека треков', 'Дуэты и ремиксы'] },
          { id: 'shorts.tools.effects', label: 'Эффекты', icon: Sparkles, path: '/shorts/effects', planned: ['Фильтры', 'Маски', 'Монтаж в приложении'] },
        ],
      },
    ],
  },
  {
    id: 'photos',
    label: 'Фото',
    short: 'Фото',
    icon: Camera,
    path: '/photos',
    description: 'Фотографии, истории и подборки',
    children: [
      { id: 'photos.feed', label: 'Лента фото', icon: Image, path: '/photos' },
      { id: 'photos.following', label: 'Подписки', icon: UserCheck, path: '/photos/following' },
      { id: 'photos.explore', label: 'Интересное', icon: Compass, path: '/photos/explore' },
      {
        id: 'photos.stories',
        label: 'Истории',
        icon: Timer,
        children: [
          { id: 'photos.stories.all', label: 'Все истории', icon: Eye, path: '/stories' },
          { id: 'photos.stories.new', label: 'Новая история', icon: Plus, path: '/stories/new' },
          { id: 'photos.stories.archive', label: 'Архив и Актуальное', icon: Archive, path: '/stories/archive', keywords: ['архив', 'актуальное', 'highlights'] },
        ],
      },
      { id: 'photos.new', label: 'Опубликовать фото', icon: ImagePlus, path: '/photos/new' },
      { id: 'photos.saved', label: 'Сохранённые', icon: Bookmark, path: '/photos/saved' },
    ],
  },
  {
    id: 'communities',
    label: 'Сообщества',
    short: 'Сообщ.',
    icon: Users,
    path: '/communities',
    description: 'Тематические сообщества с общей лентой',
    children: [
      { id: 'communities.mine', label: 'Мои сообщества', icon: Users, path: '/communities' },
      { id: 'communities.discover', label: 'Обзор', icon: Compass, path: '/communities/discover' },
      { id: 'communities.new', label: 'Создать сообщество', icon: Plus, path: '/communities/new' },
      { id: 'communities.events', label: 'События', icon: Calendar, path: '/communities/events', planned: ['Встречи и мероприятия', 'Регистрация участников', 'Напоминания'] },
    ],
  },
  {
    id: 'explore',
    label: 'Обзор',
    short: 'Поиск',
    icon: Compass,
    path: '/search',
    description: 'Поиск, тренды и новые люди',
    children: [
      { id: 'explore.search', label: 'Поиск', icon: Search, path: '/search' },
      { id: 'explore.channels', label: 'Каналы', icon: Megaphone, path: '/chats/discover' },
      { id: 'explore.communities', label: 'Сообщества', icon: Users, path: '/communities/discover' },
    ],
  },
  {
    id: 'notifications',
    label: 'Уведомления',
    short: 'Уведомл.',
    icon: Bell,
    path: '/notifications',
    badge: 'notifications',
    description: 'Ответы, упоминания, подписчики и события безопасности',
    children: [
      { id: 'notifications.all', label: 'Все', icon: Bell, path: '/notifications' },
      { id: 'notifications.mentions', label: 'Упоминания', icon: AtSign, path: '/notifications/mentions' },
      { id: 'notifications.replies', label: 'Ответы и комментарии', icon: MessageSquare, path: '/notifications/replies' },
      { id: 'notifications.likes', label: 'Отметки и репосты', icon: Repeat2, path: '/notifications/likes' },
      { id: 'notifications.follows', label: 'Подписчики', icon: UserPlus, path: '/notifications/follows' },
      { id: 'notifications.requests', label: 'Заявки', icon: UserCheck, path: '/notifications/requests', badge: 'requests' },
      { id: 'notifications.security', label: 'Безопасность', icon: Shield, path: '/notifications/security' },
    ],
  },
  {
    id: 'profile',
    label: 'Профиль',
    short: 'Профиль',
    icon: CircleUser,
    path: '/profile',
    description: 'Ваша страница и публикации',
    children: [
      { id: 'profile.overview', label: 'Моя страница', icon: User, path: '/profile' },
      {
        id: 'profile.content',
        label: 'Публикации',
        icon: LayoutGrid,
        children: [
          { id: 'profile.content.posts', label: 'Посты', icon: Newspaper, path: '/profile/posts' },
          { id: 'profile.content.photos', label: 'Фото', icon: Image, path: '/profile/photos' },
          { id: 'profile.content.videos', label: 'Видео', icon: SquarePlay, path: '/profile/videos' },
          { id: 'profile.content.shorts', label: 'Клипы', icon: Clapperboard, path: '/profile/shorts' },
          { id: 'profile.content.likes', label: 'Лайки', icon: Heart, path: '/profile/likes' },
        ],
      },
      { id: 'profile.followers', label: 'Подписчики', icon: Users, path: '/contacts/followers' },
      { id: 'profile.following', label: 'Подписки', icon: UserCheck, path: '/contacts/following' },
      { id: 'profile.edit', label: 'Редактировать профиль', icon: PenLine, path: '/settings/account/profile' },
    ],
  },
  {
    id: 'services',
    label: 'Сервисы',
    short: 'Сервисы',
    icon: Zap,
    path: '/services',
    description: 'Дополнительные модули платформы',
    children: [
      { id: 'services.music', label: 'Музыка', icon: Music, path: '/services/music', planned: ['Каталог треков и альбомов', 'Плейлисты и радио', 'Отправка треков в чаты'] },
      { id: 'services.podcasts', label: 'Подкасты', icon: Mic, path: '/services/podcasts', planned: ['Подписка на подкасты', 'Скорость воспроизведения', 'Офлайн-прослушивание'] },
      { id: 'services.market', label: 'Маркетплейс', icon: ShoppingBag, path: '/services/market', planned: ['Объявления', 'Магазины авторов', 'Безопасная сделка'] },
      { id: 'services.wallet', label: 'Кошелёк', icon: Wallet, path: '/services/wallet', planned: ['Переводы в чатах', 'Оплата подписок', 'История операций'] },
      { id: 'services.games', label: 'Игры', icon: Gamepad2, path: '/services/games', planned: ['HTML5-игры в чатах', 'Турниры с друзьями', 'Таблицы рекордов'] },
      { id: 'services.events', label: 'Афиша', icon: Ticket, path: '/services/events', planned: ['События рядом', 'Билеты', 'Пригласить друзей'] },
      { id: 'services.cloud', label: 'Облако', icon: Cloud, path: '/services/cloud', planned: ['Хранилище файлов', 'Общие папки', 'Шифрование на стороне клиента'] },
      { id: 'services.business', label: 'Для бизнеса', icon: Store, path: '/services/business', planned: ['Бизнес-профили', 'Автоответы', 'Каталог товаров в чате'] },
      { id: 'services.ai', label: 'Ассистент', icon: Brain, path: '/services/assistant', planned: ['Краткий пересказ длинных чатов', 'Помощь с ответами', 'Перевод сообщений'] },
    ],
  },
  {
    id: 'settings',
    label: 'Настройки',
    short: 'Настройки',
    icon: Settings,
    path: '/settings',
    description: 'Аккаунт, приватность, безопасность и оформление',
    children: [
      {
        id: 'settings.account',
        label: 'Аккаунт',
        icon: User,
        children: [
          { id: 'settings.account.profile', label: 'Профиль', icon: PenLine, path: '/settings/account/profile', keywords: ['аватар', 'имя', 'био'] },
          { id: 'settings.account.username', label: 'Имя пользователя', icon: AtSign, path: '/settings/account/username' },
          { id: 'settings.account.email', label: 'Почта', icon: Mail, path: '/settings/account/email', keywords: ['email', 'почта', 'письма', 'подтвердить'] },
          { id: 'settings.account.phone', label: 'Телефон', icon: Phone, path: '/settings/account/phone', keywords: ['номер', 'телефон'] },
          { id: 'settings.account.export', label: 'Экспорт данных', icon: Download, path: '/settings/account/export' },
          { id: 'settings.account.delete', label: 'Удаление аккаунта', icon: Trash2, path: '/settings/account/delete' },
        ],
      },
      {
        id: 'settings.privacy',
        label: 'Конфиденциальность',
        icon: Eye,
        children: [
          { id: 'settings.privacy.profile', label: 'Видимость профиля', icon: User, path: '/settings/privacy/profile', keywords: ['закрытый профиль'] },
          { id: 'settings.privacy.messages', label: 'Кто может писать', icon: MessageCircle, path: '/settings/privacy/messages' },
          { id: 'settings.privacy.phone', label: 'Номер телефона', icon: Phone, path: '/settings/privacy/phone', keywords: ['телефон', 'поиск по номеру'] },
          { id: 'settings.privacy.lastseen', label: 'Время захода', icon: Clock, path: '/settings/privacy/last-seen', keywords: ['онлайн', 'был в сети'] },
          { id: 'settings.privacy.interactions', label: 'Комментарии и отметки', icon: MessageSquare, path: '/settings/privacy/interactions' },
          { id: 'settings.privacy.blocked', label: 'Чёрный список', icon: UserX, path: '/settings/privacy/blocked' },
          { id: 'settings.privacy.muted', label: 'Скрытые авторы', icon: VolumeX, path: '/settings/privacy/muted' },
          { id: 'settings.privacy.mutedwords', label: 'Скрытые слова', icon: Hash, path: '/settings/privacy/muted-words', keywords: ['фильтр', 'спойлеры', 'слова', 'теги'] },
          { id: 'settings.privacy.close', label: 'Близкие друзья', icon: Star, path: '/settings/privacy/close-friends', keywords: ['close friends', 'истории', 'зелёный круг'] },
        ],
      },
      {
        id: 'settings.security',
        label: 'Безопасность',
        icon: ShieldCheck,
        children: [
          { id: 'settings.security.overview', label: 'Проверка безопасности', icon: ShieldCheck, path: '/settings/security' },
          { id: 'settings.security.password', label: 'Пароль', icon: KeyRound, path: '/settings/security/password' },
          { id: 'settings.security.2fa', label: 'Двухфакторная защита', icon: ShieldCheck, path: '/settings/security/2fa', keywords: ['2fa', 'totp', 'код', 'почта'] },
          { id: 'settings.security.sessions', label: 'Устройства и сеансы', icon: Smartphone, path: '/settings/security/sessions' },
          { id: 'settings.security.keys', label: 'Ключи шифрования', icon: Fingerprint, path: '/settings/security/keys', keywords: ['e2e'] },
          { id: 'settings.security.passcode', label: 'Код-пароль', icon: Lock, path: '/settings/security/passcode', keywords: ['pin', 'блокировка'] },
          { id: 'settings.security.log', label: 'Журнал безопасности', icon: ScrollText, path: '/settings/security/log' },
        ],
      },
      {
        id: 'settings.notifications',
        label: 'Уведомления и звуки',
        icon: Bell,
        children: [
          { id: 'settings.notifications.what', label: 'Что присылать', icon: Bell, path: '/settings/notifications', keywords: ['уведомления', 'пуш'] },
          { id: 'settings.notifications.sounds', label: 'Звуки', icon: Volume2, path: '/settings/notifications/sounds', keywords: ['громкость', 'мелодия', 'рингтон'] },
          { id: 'settings.notifications.quiet', label: 'Не беспокоить', icon: Moon, path: '/settings/notifications/quiet', keywords: ['тихие часы', 'ночь', 'расписание'] },
        ],
      },
      {
        id: 'settings.appearance',
        label: 'Оформление',
        icon: Palette,
        children: [
          { id: 'settings.appearance.theme', label: 'Тема', icon: Palette, path: '/settings/appearance/theme', keywords: ['тёмная', 'светлая'] },
          { id: 'settings.appearance.accent', label: 'Цвет акцента', icon: Palette, path: '/settings/appearance/accent' },
          { id: 'settings.appearance.text', label: 'Размер текста', icon: Type, path: '/settings/appearance/text' },
          { id: 'settings.appearance.density', label: 'Плотность', icon: LayoutGrid, path: '/settings/appearance/density' },
          { id: 'settings.appearance.font', label: 'Шрифт и углы', icon: Type, path: '/settings/appearance/font', keywords: ['шрифт', 'скругление', 'засечки'] },
        ],
      },
      { id: 'settings.behavior', label: 'Поведение', icon: Gauge, path: '/settings/behavior', keywords: ['стартовая страница', 'орфография', 'enter', 'эмодзи'] },
      { id: 'settings.power', label: 'Энергосбережение', icon: BatteryCharging, path: '/settings/power', keywords: ['батарея', 'экономия', 'анимации'] },
      {
        id: 'settings.chats',
        label: 'Чаты и медиа',
        icon: MessageCircle,
        children: [
          { id: 'settings.chats.wallpaper', label: 'Обои и текст', icon: Palette, path: '/settings/chats/wallpaper', keywords: ['фон', 'обои', 'размер текста', 'пузыри'] },
          { id: 'settings.chats.input', label: 'Отправка сообщений', icon: Keyboard, path: '/settings/chats/input' },
          { id: 'settings.chats.media', label: 'Медиа и трафик', icon: Image, path: '/settings/chats/media' },
          { id: 'settings.chats.stickers', label: 'Стикеры и эмодзи', icon: Star, path: '/settings/chats/stickers', planned: ['Наборы стикеров', 'Свои эмодзи', 'GIF-поиск'] },
        ],
      },
      { id: 'settings.data', label: 'Данные и память', icon: Database, path: '/settings/data' },
      { id: 'settings.language', label: 'Язык', icon: Languages, path: '/settings/language' },
      { id: 'settings.accessibility', label: 'Специальные возможности', icon: Accessibility, path: '/settings/accessibility' },
      { id: 'settings.shortcuts', label: 'Горячие клавиши', icon: Keyboard, path: '/settings/shortcuts' },
      { id: 'settings.admin', label: 'Модерация', icon: Flag, path: '/admin/reports', adminOnly: true },
      { id: 'settings.about', label: 'О приложении', icon: Info, path: '/settings/about' },
    ],
  },
];

export interface FlatNode {
  node: NavNode;
  section: NavSection;
  trail: NavNode[];
}

function flattenAll(): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (node: NavNode, section: NavSection, trail: NavNode[]) => {
    out.push({ node, section, trail });
    for (const c of node.children ?? []) walk(c, section, [...trail, node]);
  };
  for (const s of sections) for (const c of s.children) walk(c, s, [s]);
  return out;
}

export const flatNodes: FlatNode[] = flattenAll();

/** Узел, лучше всего соответствующий адресу (самое длинное совпадение префикса). */
export function findByPath(pathname: string): FlatNode | null {
  let best: FlatNode | null = null;
  for (const f of flatNodes) {
    const p = f.node.path;
    if (!p) continue;
    const match = pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`);
    if (match && (!best || p.length > (best.node.path?.length ?? 0))) best = f;
  }
  return best;
}

export function exactNode(pathname: string): FlatNode | null {
  return flatNodes.find((f) => f.node.path === pathname) ?? null;
}

const SECTION_PREFIXES: [string, string][] = [
  ['/chats', 'messenger'],
  ['/contacts', 'messenger'],
  ['/calls', 'messenger'],
  ['/feed', 'feed'],
  ['/post', 'feed'],
  ['/tag', 'feed'],
  ['/video', 'video'],
  ['/watch', 'video'],
  ['/playlist', 'video'],
  ['/shorts', 'shorts'],
  ['/photos', 'photos'],
  ['/stories', 'photos'],
  ['/communities', 'communities'],
  ['/c/', 'communities'],
  ['/search', 'explore'],
  ['/explore', 'explore'],
  ['/notifications', 'notifications'],
  ['/profile', 'profile'],
  ['/u/', 'profile'],
  ['/services', 'services'],
  ['/settings', 'settings'],
  ['/admin', 'settings'],
];

export function sectionFor(pathname: string): NavSection {
  const hit = SECTION_PREFIXES.find(([p]) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname.startsWith(p));
  return sections.find((s) => s.id === hit?.[1]) ?? sections[0]!;
}

export const mobileTabs = ['messenger', 'feed', 'shorts', 'video'] as const;
