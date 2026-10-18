import { lazy, type ComponentType, type ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './layout/Shell';
import { ComingSoon } from '../features/misc/ComingSoon';
import { START_PAGES, usePrefs } from '../shared/stores/prefs';

/**
 * Каждый модуль загружается отдельным чанком при первом заходе в раздел —
 * быстрый старт на мобильном интернете.
 */
function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<Record<string, unknown>> })));
}

const chats = () => import('../features/chats');
const feed = () => import('../features/feed');
const video = () => import('../features/video');
const shorts = () => import('../features/shorts');
const stories = () => import('../features/stories');
const profile = () => import('../features/profile');
const spaces = () => import('../features/spaces');
const explore = () => import('../features/explore');
const notifications = () => import('../features/notifications');
const settings = () => import('../features/settings');
const calls = () => import('../features/calls');
const social = () => import('../features/social');

const ChatsLayout = lazyNamed(chats, 'ChatsLayout');
const NoChatSelected = lazyNamed(chats, 'NoChatSelected');
const NoChannelSelected = lazyNamed(chats, 'NoChannelSelected');
const ChatView = lazyNamed(chats, 'ChatView');
const NewChatPage = lazyNamed(chats, 'NewChatPage');
const DiscoverChannels = lazyNamed(chats, 'DiscoverChannels');
const OpenSaved = lazyNamed(chats, 'OpenSaved');
const FoldersPage = lazyNamed(chats, 'FoldersPage');
const JoinPage = lazyNamed(chats, 'JoinPage');
const CallsPage = lazyNamed(calls, 'CallsPage');
const stats = () => import('../features/stats');
const live = () => import('../features/live');
const LiveHome = lazyNamed(live, 'LiveHome');
const GoLivePage = lazyNamed(live, 'GoLivePage');
const LiveRoom = lazyNamed(live, 'LiveRoom');
const PremieresPage = lazyNamed(live, 'PremieresPage');
const StatsPage = lazyNamed(stats, 'StatsPage');
const ChannelsStatsPage = lazyNamed(stats, 'ChannelsStatsPage');
const ChannelStatsPage = lazyNamed(stats, 'ChannelStatsPage');
const SubscriptionsPage = lazyNamed(stats, 'SubscriptionsPage');

const FeedPage = lazyNamed(feed, 'FeedPage');
const ComposePage = lazyNamed(feed, 'ComposePage');
const PostPage = lazyNamed(feed, 'PostPage');
const HashtagsPage = lazyNamed(feed, 'HashtagsPage');
const TagPage = lazyNamed(feed, 'TagPage');
const SavedPostsPage = lazyNamed(feed, 'SavedPostsPage');
const DraftsPage = lazyNamed(social, 'DraftsPage');
const ListsPage = lazyNamed(social, 'ListsPage');
const ListPage = lazyNamed(social, 'ListPage');
const CollectionPage = lazyNamed(social, 'CollectionPage');
const MutedWordsPage = lazyNamed(social, 'MutedWordsPage');

const VideoHome = lazyNamed(video, 'VideoHome');
const WatchPage = lazyNamed(video, 'WatchPage');
const HistoryPage = lazyNamed(video, 'HistoryPage');
const LibraryList = lazyNamed(video, 'LibraryList');
const PlaylistsPage = lazyNamed(video, 'PlaylistsPage');
const PlaylistPage = lazyNamed(video, 'PlaylistPage');
const StudioPage = lazyNamed(video, 'StudioPage');
const UploadVideoPage = lazyNamed(video, 'UploadVideoPage');

const ShortsFeed = lazyNamed(shorts, 'ShortsFeed');
const CreateShortPage = lazyNamed(shorts, 'CreateShortPage');
const MyShortsPage = lazyNamed(shorts, 'MyShortsPage');

const StoriesPage = lazyNamed(stories, 'StoriesPage');
const NewStoryPage = lazyNamed(stories, 'NewStoryPage');
const StoriesArchivePage = lazyNamed(stories, 'ArchivePage');
const CloseFriendsPage = lazyNamed(stories, 'CloseFriendsPage');

const ProfilePage = lazyNamed(profile, 'ProfilePage');
const FollowListPage = lazyNamed(profile, 'FollowListPage');

const SpacesHome = lazyNamed(spaces, 'SpacesHome');
const DiscoverSpaces = lazyNamed(spaces, 'DiscoverSpaces');
const NewSpacePage = lazyNamed(spaces, 'NewSpacePage');
const SpaceLayout = lazyNamed(spaces, 'SpaceLayout');
const SpaceWelcome = lazyNamed(spaces, 'SpaceWelcome');
const JoinSpaceLink = lazyNamed(spaces, 'JoinSpaceLink');

const SearchPage = lazyNamed(explore, 'SearchPage');

const NotificationsPage = lazyNamed(notifications, 'NotificationsPage');
const FollowRequestsPage = lazyNamed(notifications, 'FollowRequestsPage');

const SettingsHome = lazyNamed(settings, 'SettingsHome');
const ProfileSettings = lazyNamed(settings, 'ProfileSettings');
const UsernameSettings = lazyNamed(settings, 'UsernameSettings');
const EmailSettings = lazyNamed(settings, 'EmailSettings');
const PhoneSettings = lazyNamed(settings, 'PhoneSettings');
const ExportSettings = lazyNamed(settings, 'ExportSettings');
const DeleteAccountSettings = lazyNamed(settings, 'DeleteAccountSettings');
const PrivacySettings = lazyNamed(settings, 'PrivacySettings');
const RelationsList = lazyNamed(settings, 'RelationsList');
const SecurityOverview = lazyNamed(settings, 'SecurityOverview');
const PasswordSettings = lazyNamed(settings, 'PasswordSettings');
const TwoFactorSettings = lazyNamed(settings, 'TwoFactorSettings');
const SessionsSettings = lazyNamed(settings, 'SessionsSettings');
const KeysSettings = lazyNamed(settings, 'KeysSettings');
const PasscodeSettings = lazyNamed(settings, 'PasscodeSettings');
const SecurityLogSettings = lazyNamed(settings, 'SecurityLogSettings');
const NotificationSettingsPage = lazyNamed(settings, 'NotificationSettingsPage');
const AppearanceSettings = lazyNamed(settings, 'AppearanceSettings');
const ChatSettings = lazyNamed(settings, 'ChatSettings');
const DataSettings = lazyNamed(settings, 'DataSettings');
const LanguageSettings = lazyNamed(settings, 'LanguageSettings');
const AccessibilitySettings = lazyNamed(settings, 'AccessibilitySettings');
const ShortcutsSettings = lazyNamed(settings, 'ShortcutsSettings');
const AboutSettings = lazyNamed(settings, 'AboutSettings');
const AdminReports = lazyNamed(settings, 'AdminReports');
const SoundsSettings = lazyNamed(settings, 'SoundsSettings');
const QuietSettings = lazyNamed(settings, 'QuietSettings');
const FontSettings = lazyNamed(settings, 'FontSettings');
const BehaviorSettings = lazyNamed(settings, 'BehaviorSettings');
const PowerSettings = lazyNamed(settings, 'PowerSettings');
const SpaceModeSettings = lazyNamed(settings, 'SpaceModeSettings');
const CallsSettings = lazyNamed(settings, 'CallsSettings');

/** Стартовая страница — из настроек «Поведение» (устаревшие значения ведут на главную) */
function StartRedirect() {
  const start = usePrefs((s) => s.startPage);
  return <Navigate to={start && START_PAGES.includes(start) ? start : '/home'} replace />;
}

/** Все экраны приложения. layout — оболочка: обычная (Shell) или окно «Пространства». */
export function AppRoutes({ layout }: { layout?: ReactElement } = {}) {
  return (
    <Routes>
      <Route element={layout ?? <Shell />}>
        <Route index element={<StartRedirect />} />
        {/* Главная — лента: зашёл и сразу листаешь */}
        <Route path="home" element={<FeedPage mode="" />} />
        <Route path="home/following" element={<FeedPage mode="following" />} />
        <Route path="home/latest" element={<FeedPage mode="latest" />} />
        <Route path="home/popular" element={<FeedPage mode="trending" />} />
        {/* После входа адреса страницы входа больше не нужны */}
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="register" element={<Navigate to="/" replace />} />

        {/* Мессенджер */}
        <Route path="chats" element={<ChatsLayout />}>
          <Route index element={<NoChatSelected />} />
          <Route path="folder/:folder" element={<NoChatSelected />} />
          <Route path="saved" element={<OpenSaved />} />
          <Route path="discover" element={<DiscoverChannels only="group" />} />
          <Route path="folders" element={<FoldersPage />} />
          <Route path="new/:kind" element={<NewChatPage />} />
          <Route path=":chatId" element={<ChatView />} />
        </Route>

        {/* Каналы */}
        <Route path="channels" element={<ChatsLayout variant="channels" />}>
          <Route index element={<NoChannelSelected />} />
          <Route path="discover" element={<DiscoverChannels only="channel" />} />
          <Route path="new" element={<NewChatPage kind="channel" />} />
          <Route path=":chatId" element={<ChatView />} />
        </Route>
        <Route path="join/:token" element={<JoinPage />} />
        <Route path="calls" element={<Navigate to="/stats/calls" replace />} />
        <Route path="contacts/following" element={<FollowListPage which="following" />} />
        <Route path="contacts/followers" element={<FollowListPage which="followers" />} />
        <Route path="contacts/suggestions" element={<FollowListPage which="suggestions" />} />

        {/* Лента: публикации, закладки, черновики */}
        <Route path="feed" element={<Navigate to="/home" replace />} />
        <Route path="feed/compose" element={<ComposePage />} />
        <Route path="feed/hashtags" element={<HashtagsPage />} />
        <Route path="feed/bookmarks" element={<SavedPostsPage kind="bookmarks" />} />
        <Route path="feed/liked" element={<SavedPostsPage kind="liked" />} />
        <Route path="feed/drafts" element={<DraftsPage filter="drafts" />} />
        <Route path="feed/scheduled" element={<DraftsPage filter="scheduled" />} />
        <Route path="feed/lists" element={<ListsPage />} />
        <Route path="feed/lists/:id" element={<ListPage />} />
        <Route path="feed/collections/:id" element={<CollectionPage />} />
        <Route path="post/:id" element={<PostPage />} />
        <Route path="tag/:tag" element={<TagPage />} />

        {/* Видео */}
        <Route path="video" element={<VideoHome mode="for-you" />} />
        <Route path="video/subscriptions" element={<VideoHome mode="following" />} />
        <Route path="video/trending" element={<VideoHome mode="trending" />} />
        <Route path="video/history" element={<HistoryPage />} />
        <Route path="video/watch-later" element={<LibraryList kind="watch-later" />} />
        <Route path="video/liked" element={<LibraryList kind="liked" />} />
        <Route path="video/playlists" element={<PlaylistsPage />} />
        <Route path="video/studio" element={<StudioPage tab="dashboard" />} />
        <Route path="video/studio/content" element={<StudioPage tab="content" />} />
        <Route path="video/upload" element={<UploadVideoPage />} />
        <Route path="watch/:id" element={<WatchPage />} />
        <Route path="live" element={<LiveHome />} />
        <Route path="live/new" element={<GoLivePage />} />
        <Route path="live/:id" element={<LiveRoom />} />
        <Route path="premieres" element={<PremieresPage />} />
        <Route path="playlist/:id" element={<PlaylistPage />} />

        {/* Кометы — короткие вертикальные видео */}
        <Route path="comets" element={<ShortsFeed mode="for-you" />} />
        <Route path="comets/following" element={<ShortsFeed mode="following" />} />
        <Route path="comets/popular" element={<ShortsFeed mode="trending" />} />
        <Route path="comets/new" element={<CreateShortPage />} />
        <Route path="comets/mine" element={<MyShortsPage />} />
        <Route path="shorts" element={<Navigate to="/comets" replace />} />

        {/* Истории */}
        <Route path="stories" element={<StoriesPage />} />
        <Route path="stories/new" element={<NewStoryPage />} />
        <Route path="stories/archive" element={<StoriesArchivePage />} />

        {/* Сообщества */}
        <Route path="communities" element={<SpacesHome kind="community" />} />
        <Route path="communities/discover" element={<DiscoverSpaces />} />
        <Route path="communities/new" element={<NewSpacePage kind="community" />} />
        <Route path="communities/:spaceId" element={<SpaceLayout />}>
          <Route index element={<SpaceWelcome />} />
          <Route path=":chatId" element={<ChatView />} />
        </Route>
        <Route path="s/:token" element={<JoinSpaceLink />} />

        {/* Компании */}
        <Route path="companies" element={<SpacesHome kind="company" />} />
        <Route path="companies/new" element={<NewSpacePage kind="company" />} />
        <Route path="companies/:spaceId" element={<SpaceLayout />}>
          <Route index element={<SpaceWelcome />} />
          <Route path=":chatId" element={<ChatView />} />
        </Route>

        {/* Поиск */}
        <Route path="search" element={<SearchPage />} />

        {/* Статистика */}
        <Route path="stats" element={<StatsPage />} />
        <Route path="stats/channels" element={<ChannelsStatsPage />} />
        <Route path="stats/channels/:id" element={<ChannelStatsPage />} />
        <Route path="stats/subscriptions" element={<SubscriptionsPage />} />
        <Route path="stats/calls" element={<CallsPage filter="all" />} />
        <Route path="stats/calls/missed" element={<CallsPage filter="missed" />} />

        {/* Уведомления */}
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="notifications/requests" element={<FollowRequestsPage />} />
        <Route path="notifications/:filter" element={<NotificationsPage />} />

        {/* Профиль */}
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/:tab" element={<ProfilePage />} />
        <Route path="u/:username" element={<ProfilePage />} />
        <Route path="u/:username/followers" element={<FollowListPage which="followers" />} />
        <Route path="u/:username/following" element={<FollowListPage which="following" />} />
        <Route path="u/:username/:tab" element={<ProfilePage />} />

        {/* Настройки */}
        <Route path="settings" element={<SettingsHome />} />
        <Route path="settings/account" element={<Navigate to="/settings/account/profile" replace />} />
        <Route path="settings/account/profile" element={<ProfileSettings />} />
        <Route path="settings/account/username" element={<UsernameSettings />} />
        <Route path="settings/account/email" element={<EmailSettings />} />
        <Route path="settings/account/phone" element={<PhoneSettings />} />
        <Route path="settings/account/export" element={<ExportSettings />} />
        <Route path="settings/account/delete" element={<DeleteAccountSettings />} />
        <Route path="settings/privacy" element={<Navigate to="/settings/privacy/profile" replace />} />
        <Route path="settings/privacy/profile" element={<PrivacySettings section="profile" />} />
        <Route path="settings/privacy/messages" element={<PrivacySettings section="messages" />} />
        <Route path="settings/privacy/last-seen" element={<PrivacySettings section="last-seen" />} />
        <Route path="settings/privacy/phone" element={<PrivacySettings section="phone" />} />
        <Route path="settings/privacy/interactions" element={<PrivacySettings section="interactions" />} />
        <Route path="settings/privacy/blocked" element={<RelationsList which="blocks" />} />
        <Route path="settings/privacy/muted" element={<RelationsList which="mutes" />} />
        <Route path="settings/privacy/close-friends" element={<CloseFriendsPage />} />
        <Route path="settings/privacy/muted-words" element={<MutedWordsPage />} />
        <Route path="settings/security" element={<SecurityOverview />} />
        <Route path="settings/security/password" element={<PasswordSettings />} />
        <Route path="settings/security/2fa" element={<TwoFactorSettings />} />
        <Route path="settings/security/sessions" element={<SessionsSettings />} />
        <Route path="settings/security/keys" element={<KeysSettings />} />
        <Route path="settings/security/passcode" element={<PasscodeSettings />} />
        <Route path="settings/security/log" element={<SecurityLogSettings />} />
        <Route path="settings/notifications" element={<NotificationSettingsPage />} />
        <Route path="settings/notifications/sounds" element={<SoundsSettings />} />
        <Route path="settings/notifications/quiet" element={<QuietSettings />} />
        <Route path="settings/appearance/font" element={<FontSettings />} />
        <Route path="settings/behavior" element={<BehaviorSettings />} />
        <Route path="settings/power" element={<PowerSettings />} />
        <Route path="settings/space" element={<SpaceModeSettings />} />
        <Route path="settings/calls" element={<CallsSettings />} />
        <Route path="settings/appearance" element={<Navigate to="/settings/appearance/theme" replace />} />
        <Route path="settings/appearance/theme" element={<AppearanceSettings section="theme" />} />
        <Route path="settings/appearance/accent" element={<AppearanceSettings section="accent" />} />
        <Route path="settings/appearance/text" element={<AppearanceSettings section="text" />} />
        <Route path="settings/appearance/density" element={<AppearanceSettings section="density" />} />
        <Route path="settings/chats/input" element={<ChatSettings section="input" />} />
        <Route path="settings/chats/media" element={<ChatSettings section="media" />} />
        <Route path="settings/chats/wallpaper" element={<ChatSettings section="wallpaper" />} />
        <Route path="settings/data" element={<DataSettings />} />
        <Route path="settings/language" element={<LanguageSettings />} />
        <Route path="settings/accessibility" element={<AccessibilitySettings />} />
        <Route path="settings/shortcuts" element={<ShortcutsSettings />} />
        <Route path="settings/about" element={<AboutSettings />} />
        <Route path="admin/reports" element={<AdminReports />} />

        {/* Всё остальное: страница-дорожная карта для запланированных разделов или 404 */}
        <Route path="*" element={<ComingSoon />} />
      </Route>
    </Routes>
  );
}
