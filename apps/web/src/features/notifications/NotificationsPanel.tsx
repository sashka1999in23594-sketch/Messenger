/** Центр уведомлений — панель, выезжающая справа (как центр уведомлений Windows). */
import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, CheckCheck, Settings, X } from 'lucide-react';
import type { AppNotification } from '@omni/shared';
import { api } from '../../shared/api/client';
import { flatPages, qk, queryClient, useCursorList } from '../../shared/api/query';
import { useUi } from '../../shared/stores/ui';
import { EmptyState, ListSkeleton } from '../../shared/ui';
import { NotificationRow, useFollowingIds } from './index';
import './notifications.css';

/**
 * Панель центра уведомлений. `onOpen` переводит пользователя по ссылке:
 * в обычной раскладке — роутер, на рабочем столе — открытие окна раздела.
 */
export function NotificationsPanel({ onOpen }: { onOpen: (to: string) => void }) {
  const open = useUi((s) => s.notifOpen);
  const setNotif = useUi((s) => s.setNotif);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNotif(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setNotif]);
  if (!open) return null;
  const close = () => setNotif(false);
  const go = (to: string) => {
    close();
    onOpen(to);
  };
  return <Body close={close} go={go} />;
}

function Body({ close, go }: { close: () => void; go: (to: string) => void }) {
  const list = useCursorList<AppNotification>(qk.notifications('all'), '/notifications?filter=all');
  const items = flatPages(list.data).slice(0, 30);
  const following = useFollowingIds();
  const unread = items.some((n) => !n.readAt);
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  // Открыли центр — помечаем видимые как прочитанные (с задержкой, чтобы успеть заметить подсветку)
  useEffect(() => {
    const ids = items.filter((n) => !n.readAt).map((n) => n.id);
    if (!ids.length) return;
    const t = setTimeout(() => void api.post('/notifications/read', { ids }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] })), 2500);
    return () => clearTimeout(t);
  }, [items]);
  return (
    <div className="notif-center" role="dialog" aria-modal="true" aria-label="Центр уведомлений">
      <button type="button" className="notif-center__scrim" aria-label="Закрыть" onClick={close} />
      <aside className="notif-center__panel">
        <header className="notif-center__head">
          <Bell size={18} />
          <b className="grow">Уведомления</b>
          <button type="button" className="notif-center__act" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()} title="Прочитать все" aria-label="Прочитать все">
            <CheckCheck size={18} />
          </button>
          <button type="button" className="notif-center__act" onClick={() => go('/settings/notifications')} title="Настройки уведомлений" aria-label="Настройки уведомлений">
            <Settings size={18} />
          </button>
          <button type="button" className="notif-center__act" onClick={close} title="Закрыть" aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="notif-center__list scroll">
          {list.isLoading ? (
            <ListSkeleton rows={6} avatar={44} />
          ) : items.length === 0 ? (
            <EmptyState icon={<Bell size={26} />} title="Уведомлений нет" text="Здесь появятся лайки, ответы, упоминания и подписки" />
          ) : (
            items.map((n) => <NotificationRow key={n.id} n={n} followingIds={following.data} onOpen={go} />)
          )}
        </div>
        <footer className="notif-center__foot">
          <button type="button" className="notif-center__all" onClick={() => go('/notifications')}>
            Все уведомления
          </button>
        </footer>
      </aside>
    </div>
  );
}
