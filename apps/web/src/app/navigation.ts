/**
 * Реестр навигации — единый источник правды о структуре приложения.
 * Из него строятся: рельс разделов, дерево подразделов, хлебные крошки,
 * командная палитра (Ctrl+K) и мобильные вкладки.
 *
 * Добавить раздел = добавить узел сюда и маршрут в routes.tsx. Узел с
 * `planned` получает страницу-дорожную карту — только для того, что уже в работе.
 */
import {
  Accessibility,
  House,
  BatteryCharging,
  Gauge,
  Moon,
  Volume2,
  Archive,
  AtSign,
  Bell,
  Bookmark,
  Briefcase,
  Calendar,
  ChartColumn,
  CircleUser,
  Clapperboard,
  Clock,
  Compass,
  Database,
  Download,
  Eye,
  Fingerprint,
  Flag,
  Flame,
  Hash,
  Heart,
  History,
  Image,
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
  Newspaper,
  Palette,
  PenLine,
  Phone,
  Plus,
  Repeat2,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SquarePlay,
  Star,
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
  badge?: 'chats' | 'channels' | 'notifications' | 'requests';
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
    description: 'Лента: фото, видео, заметки и истории тех, на кого вы подписаны',
    children: [
      { id: 'home.foryou', label: 'Для вас', icon: Sparkles, path: '/home', keywords: ['лента', 'рекомендации', 'главная'] },
      { id: 'home.following', label: 'Подписки', icon: UserCheck, path: '/home/following' },
      { id: 'home.latest', label: 'Свежее', icon: Clock, path: '/home/latest' },
      { id: 'home.popular', label: 'Популярное', icon: Flame, path: '/home/popular', keywords: ['тренды'] },
      { id: 'home.compose', label: 'Новая публикация', icon: PenLine, path: '/feed/compose', keywords: ['пост', 'фото', 'написать'] },
      {
        id: 'home.stories',
        label: 'Истории',
        icon: Timer,
        children: [
          { id: 'home.stories.all', label: 'Все истории', icon: Eye, path: '/stories' },
          { id: 'home.stories.new', label: 'Новая история', icon: Plus, path: '/stories/new' },
          { id: 'home.stories.archive', label: 'Архив и Актуальное', icon: Archive, path: '/stories/archive', keywords: ['архив', 'актуальное', 'highlights'] },
        ],
      },
      {
        id: 'home.topics',
        label: 'Темы',
        icon: Hash,
        children: [
          { id: 'home.topics.hashtags', label: 'Хэштеги', icon: Hash, path: '/feed/hashtags' },
          { id: 'home.topics.lists', label: 'Списки', icon: ScrollText, path: '/feed/lists', keywords: ['списки авторов', 'лента списка'] },
        ],
      },
      {
        id: 'home.mine',
        label: 'Моё',
        icon: User,
        children: [
          { id: 'home.mine.bookmarks', label: 'Закладки и коллекции', icon: Bookmark, path: '/feed/bookmarks', keywords: ['коллекции', 'сохранённое', 'избранное'] },
          { id: 'home.mine.liked', label: 'Понравилось', icon: Heart, path: '/feed/liked' },
          { id: 'home.mine.drafts', label: 'Черновики', icon: PenLine, path: '/feed/drafts' },
          { id: 'home.mine.scheduled', label: 'Запланированные', icon: Calendar, path: '/feed/scheduled', keywords: ['отложенные', 'расписание'] },
        ],
      },
    ],
  },
  {
    id: 'messenger',
    label: 'Чаты',
    short: 'Чаты',
    icon: MessageCircle,
    path: '/chats',
    badge: 'chats',
    description: 'Личные переписки, группы и секретные чаты',
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
          { id: 'messenger.create.group', label: 'Новая группа', icon: Users, path: '/chats/new/group', keywords: ['открытая', 'закрытая'] },
          { id: 'messenger.create.secret', label: 'Секретный чат', icon: Lock, path: '/chats/new/secret' },
        ],
      },
      { id: 'messenger.discover', label: 'Открытые группы', icon: Compass, path: '/chats/discover', keywords: ['вступить', 'найти группу'] },
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
    ],
  },
  {
    id: 'channels',
    label: 'Каналы',
    short: 'Каналы',
    icon: Megaphone,
    path: '/channels',
    badge: 'channels',
    description: 'Публикации авторов: реакции, комментарии и просмотры',
    children: [
      { id: 'channels.mine', label: 'Мои подписки', icon: Megaphone, path: '/channels', keywords: ['каналы', 'подписки'] },
      { id: 'channels.discover', label: 'Обзор каналов', icon: Compass, path: '/channels/discover', keywords: ['найти канал', 'каталог'] },
      { id: 'channels.new', label: 'Создать канал', icon: Plus, path: '/channels/new' },
    ],
  },
  {
    id: 'comets',
    label: 'Кометы',
    short: 'Кометы',
    icon: Zap,
    path: '/comets',
    description: 'Короткие вертикальные видео: листайте вверх',
    children: [
      { id: 'comets.foryou', label: 'Для вас', icon: Sparkles, path: '/comets', keywords: ['короткие видео', 'клипы', 'shorts'] },
      { id: 'comets.following', label: 'Подписки', icon: UserCheck, path: '/comets/following' },
      { id: 'comets.popular', label: 'Популярные', icon: Flame, path: '/comets/popular' },
      { id: 'comets.new', label: 'Запустить комету', icon: Plus, path: '/comets/new', keywords: ['загрузить', 'снять'] },
      { id: 'comets.mine', label: 'Мои кометы', icon: User, path: '/comets/mine' },
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
        ],
      },
    ],
  },
  {
    id: 'companies',
    label: 'Компании',
    short: 'Компании',
    icon: Briefcase,
    path: '/companies',
    description: 'Рабочие пространства: роли, отделы и закрытые чаты',
    children: [
      { id: 'companies.mine', label: 'Мои компании', icon: Briefcase, path: '/companies', keywords: ['работа', 'команда', 'приглашения'] },
      { id: 'companies.new', label: 'Создать компанию', icon: Plus, path: '/companies/new', keywords: ['руководитель', 'роли', 'сотрудники'] },
    ],
  },
  {
    id: 'communities',
    label: 'Сообщества',
    short: 'Сообщ.',
    icon: Users,
    path: '/communities',
    description: 'Большие сообщества с множеством групп внутри',
    children: [
      { id: 'communities.mine', label: 'Мои сообщества', icon: Users, path: '/communities' },
      { id: 'communities.discover', label: 'Обзор', icon: Compass, path: '/communities/discover', keywords: ['найти сообщество', 'открытые'] },
      { id: 'communities.new', label: 'Создать сообщество', icon: Plus, path: '/communities/new' },
    ],
  },
  {
    id: 'search',
    label: 'Поиск',
    short: 'Поиск',
    icon: Search,
    path: '/search',
    description: 'Люди по имени, @username и номеру телефона, каналы, группы и сообщения',
    children: [{ id: 'search.all', label: 'Поиск', icon: Search, path: '/search', keywords: ['найти', 'телефон', 'номер'] }],
  },
  {
    id: 'notifications',
    label: 'Уведомления',
    short: 'Уведомл.',
    icon: Bell,
    path: '/notifications',
    badge: 'notifications',
    description: 'Ответы, упоминания, подписчики, приглашения и события безопасности',
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
          { id: 'profile.content.shorts', label: 'Кометы', icon: Zap, path: '/profile/shorts' },
          { id: 'profile.content.likes', label: 'Лайки', icon: Heart, path: '/profile/likes' },
        ],
      },
      { id: 'profile.followers', label: 'Подписчики', icon: Users, path: '/contacts/followers' },
      { id: 'profile.following', label: 'Подписки', icon: UserCheck, path: '/contacts/following' },
      { id: 'profile.edit', label: 'Редактировать профиль', icon: PenLine, path: '/settings/account/profile' },
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
  ['/home', 'home'],
  ['/feed', 'home'],
  ['/post', 'home'],
  ['/tag', 'home'],
  ['/stories', 'home'],
  ['/chats', 'messenger'],
  ['/contacts', 'messenger'],
  ['/join', 'messenger'],
  ['/channels', 'channels'],
  ['/comets', 'comets'],
  ['/video', 'video'],
  ['/watch', 'video'],
  ['/playlist', 'video'],
  ['/communities', 'communities'],
  ['/companies', 'companies'],
  ['/s/', 'communities'],
  ['/search', 'search'],
  ['/notifications', 'notifications'],
  ['/profile', 'profile'],
  ['/u/', 'profile'],
  ['/settings', 'settings'],
  ['/admin', 'settings'],
];

export function sectionFor(pathname: string): NavSection {
  const hit = SECTION_PREFIXES.find(([p]) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname.startsWith(p));
  return sections.find((s) => s.id === hit?.[1]) ?? sections[0]!;
}

export const mobileTabs = ['home', 'messenger', 'channels', 'comets'] as const;
