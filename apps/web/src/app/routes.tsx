import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Shell } from './layout/Shell';
import { ComingSoon } from '../features/misc/ComingSoon';

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
const photos = () => import('../features/photos');
const profile = () => import('../features/profile');
const communities = () => import('../features/communities');
const explore = () => import('../features/explore');
const notifications = () => import('../features/notifications');
const settings = () => import('../features/settings');

const ChatsLayout = lazyNamed(chats, 'ChatsLayout');
const NoChatSelected = lazyNamed(chats, 'NoChatSelected');
const ChatView = lazyNamed(chats, 'ChatView');
const NewChatPage = lazyNamed(chats, 'NewChatPage');
const DiscoverChannels = lazyNamed(chats, 'DiscoverChannels');
const OpenSaved = lazyNamed(chats, 'OpenSaved');

const FeedPage = lazyNamed(feed, 'FeedPage');
const ComposePage = lazyNamed(feed, 'ComposePage');
const PostPage = lazyNamed(feed, 'PostPage');
const HashtagsPage = lazyNamed(feed, 'HashtagsPage');
const TagPage = lazyNamed(feed, 'TagPage');
const SavedPostsPage = lazyNamed(feed, 'SavedPostsPage');

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

const PhotoFeed = lazyNamed(photos, 'PhotoFeed');
const ExplorePhotos = lazyNamed(photos, 'ExplorePhotos');
const SavedPhotos = lazyNamed(photos, 'SavedPhotos');
const NewPhotoPage = lazyNamed(photos, 'NewPhotoPage');
const StoriesPage = lazyNamed(photos, 'StoriesPage');
const NewStoryPage = lazyNamed(photos, 'NewStoryPage');

const ProfilePage = lazyNamed(profile, 'ProfilePage');
const FollowListPage = lazyNamed(profile, 'FollowListPage');

const MyCommunities = lazyNamed(communities, 'MyCommunities');
const DiscoverCommunities = lazyNamed(communities, 'DiscoverCommunities');
const NewCommunity = lazyNamed(communities, 'NewCommunity');
const CommunityPage = lazyNamed(communities, 'CommunityPage');

const SearchPage = lazyNamed(explore, 'SearchPage');
const TrendsPage = lazyNamed(explore, 'TrendsPage');
const PeoplePage = lazyNamed(explore, 'PeoplePage');

const NotificationsPage = lazyNamed(notifications, 'NotificationsPage');
const FollowRequestsPage = lazyNamed(notifications, 'FollowRequestsPage');

const SettingsHome = lazyNamed(settings, 'SettingsHome');
const ProfileSettings = lazyNamed(settings, 'ProfileSettings');
const UsernameSettings = lazyNamed(settings, 'UsernameSettings');
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
const ServicesHome = lazyNamed(settings, 'ServicesHome');

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/chats" replace />} />

        {/* Мессенджер */}
        <Route path="chats" element={<ChatsLayout />}>
          <Route index element={<NoChatSelected />} />
          <Route path="folder/:folder" element={<NoChatSelected />} />
          <Route path="saved" element={<OpenSaved />} />
          <Route path="discover" element={<DiscoverChannels />} />
          <Route path="new/:kind" element={<NewChatPage />} />
          <Route path=":chatId" element={<ChatView />} />
        </Route>
        <Route path="contacts/following" element={<FollowListPage which="following" />} />
        <Route path="contacts/followers" element={<FollowListPage which="followers" />} />
        <Route path="contacts/suggestions" element={<FollowListPage which="suggestions" />} />

        {/* Лента */}
        <Route path="feed" element={<FeedPage mode="" />} />
        <Route path="feed/following" element={<FeedPage mode="following" />} />
        <Route path="feed/latest" element={<FeedPage mode="latest" />} />
        <Route path="feed/trending" element={<FeedPage mode="trending" />} />
        <Route path="feed/compose" element={<ComposePage />} />
        <Route path="feed/hashtags" element={<HashtagsPage />} />
        <Route path="feed/bookmarks" element={<SavedPostsPage kind="bookmarks" />} />
        <Route path="feed/liked" element={<SavedPostsPage kind="liked" />} />
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
        <Route path="playlist/:id" element={<PlaylistPage />} />

        {/* Клипы */}
        <Route path="shorts" element={<ShortsFeed mode="for-you" />} />
        <Route path="shorts/following" element={<ShortsFeed mode="following" />} />
        <Route path="shorts/trending" element={<ShortsFeed mode="trending" />} />
        <Route path="shorts/create" element={<CreateShortPage />} />
        <Route path="shorts/mine" element={<MyShortsPage />} />

        {/* Фото и истории */}
        <Route path="photos" element={<PhotoFeed mode="for-you" />} />
        <Route path="photos/following" element={<PhotoFeed mode="following" />} />
        <Route path="photos/explore" element={<ExplorePhotos />} />
        <Route path="photos/new" element={<NewPhotoPage />} />
        <Route path="photos/saved" element={<SavedPhotos />} />
        <Route path="stories" element={<StoriesPage />} />
        <Route path="stories/new" element={<NewStoryPage />} />

        {/* Сообщества */}
        <Route path="communities" element={<MyCommunities />} />
        <Route path="communities/discover" element={<DiscoverCommunities />} />
        <Route path="communities/new" element={<NewCommunity />} />
        <Route path="c/:slug" element={<CommunityPage />} />

        {/* Обзор */}
        <Route path="search" element={<SearchPage />} />
        <Route path="explore/trends" element={<TrendsPage />} />
        <Route path="explore/people" element={<PeoplePage />} />

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

        {/* Сервисы */}
        <Route path="services" element={<ServicesHome />} />

        {/* Настройки */}
        <Route path="settings" element={<SettingsHome />} />
        <Route path="settings/account" element={<Navigate to="/settings/account/profile" replace />} />
        <Route path="settings/account/profile" element={<ProfileSettings />} />
        <Route path="settings/account/username" element={<UsernameSettings />} />
        <Route path="settings/account/export" element={<ExportSettings />} />
        <Route path="settings/account/delete" element={<DeleteAccountSettings />} />
        <Route path="settings/privacy" element={<Navigate to="/settings/privacy/profile" replace />} />
        <Route path="settings/privacy/profile" element={<PrivacySettings section="profile" />} />
        <Route path="settings/privacy/messages" element={<PrivacySettings section="messages" />} />
        <Route path="settings/privacy/last-seen" element={<PrivacySettings section="last-seen" />} />
        <Route path="settings/privacy/interactions" element={<PrivacySettings section="interactions" />} />
        <Route path="settings/privacy/blocked" element={<RelationsList which="blocks" />} />
        <Route path="settings/privacy/muted" element={<RelationsList which="mutes" />} />
        <Route path="settings/security" element={<SecurityOverview />} />
        <Route path="settings/security/password" element={<PasswordSettings />} />
        <Route path="settings/security/2fa" element={<TwoFactorSettings />} />
        <Route path="settings/security/sessions" element={<SessionsSettings />} />
        <Route path="settings/security/keys" element={<KeysSettings />} />
        <Route path="settings/security/passcode" element={<PasscodeSettings />} />
        <Route path="settings/security/log" element={<SecurityLogSettings />} />
        <Route path="settings/notifications" element={<NotificationSettingsPage />} />
        <Route path="settings/appearance" element={<Navigate to="/settings/appearance/theme" replace />} />
        <Route path="settings/appearance/theme" element={<AppearanceSettings section="theme" />} />
        <Route path="settings/appearance/accent" element={<AppearanceSettings section="accent" />} />
        <Route path="settings/appearance/text" element={<AppearanceSettings section="text" />} />
        <Route path="settings/appearance/density" element={<AppearanceSettings section="density" />} />
        <Route path="settings/chats/input" element={<ChatSettings section="input" />} />
        <Route path="settings/chats/media" element={<ChatSettings section="media" />} />
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
