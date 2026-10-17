import { useQuery } from '@tanstack/react-query';
import { Clock, Eye, MessageCircle, MessageSquare, User, UserX, VolumeX } from 'lucide-react';
import type { UserSummary } from '@omni/shared';
import { api } from '../../shared/api/client';
import { Button, EmptyState, SettingRow, Switch, UserRow } from '../../shared/ui';
import { AudienceSelect, Panel, SettingsPage, usePrivacy } from './common';

export function PrivacySettings({ section }: { section: 'profile' | 'messages' | 'last-seen' | 'interactions' }) {
  const { privacy, update } = usePrivacy();
  if (section === 'profile') {
    return (
      <SettingsPage title="Видимость профиля" icon={<User size={22} />}>
        <Panel footer="В закрытом профиле публикации, истории и списки подписок видят только одобренные вами подписчики. Новые подписчики отправляют заявку.">
          <SettingRow title="Закрытый профиль" description="Подписка — только по заявке" control={<Switch checked={privacy.isPrivate} onChange={(v) => update({ isPrivate: v })} label="Закрытый профиль" />} />
        </Panel>
        <Panel footer="Если выключено, вас можно найти только по точному имени пользователя.">
          <SettingRow title="Показывать в поиске" description="И в рекомендациях «Кого почитать»" control={<Switch checked={privacy.showInSearch} onChange={(v) => update({ showInSearch: v })} label="Показывать в поиске" />} />
        </Panel>
      </SettingsPage>
    );
  }
  if (section === 'messages') {
    return (
      <SettingsPage title="Кто может мне писать" subtitle="Ограничивает создание новых личных и секретных чатов, а также добавление в группы" icon={<MessageCircle size={22} />}>
        <Panel title="Новые сообщения от">
          <AudienceSelect value={privacy.whoCanMessage} onChange={(v) => update({ whoCanMessage: v })} label="Кто может писать" />
        </Panel>
      </SettingsPage>
    );
  }
  if (section === 'last-seen') {
    return (
      <SettingsPage title="Время захода и прочтение" icon={<Clock size={22} />}>
        <Panel title="Кто видит, что я в сети">
          <AudienceSelect value={privacy.lastSeenVisibility} onChange={(v) => update({ lastSeenVisibility: v })} label="Время захода" />
        </Panel>
        <Panel footer="Взаимно, как в WhatsApp: если вы выключите отчёты, то и сами не увидите, прочитали ли ваши сообщения.">
          <SettingRow title="Отчёты о прочтении" description="Двойные галочки в личных чатах" control={<Switch checked={privacy.readReceipts} onChange={(v) => update({ readReceipts: v })} label="Отчёты о прочтении" />} />
        </Panel>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title="Комментарии и отметки" icon={<MessageSquare size={22} />}>
      <Panel title="Кто может комментировать мои публикации">
        <AudienceSelect value={privacy.whoCanComment} onChange={(v) => update({ whoCanComment: v })} label="Комментарии" />
      </Panel>
      <Panel>
        <SettingRow title="Разрешить упоминания" description="Уведомлять, когда меня отмечают через @" control={<Switch checked={privacy.allowTagging} onChange={(v) => update({ allowTagging: v })} label="Упоминания" />} />
      </Panel>
    </SettingsPage>
  );
}

export function RelationsList({ which }: { which: 'blocks' | 'mutes' }) {
  const q = useQuery({ queryKey: ['relations', which], queryFn: () => api.get<{ items: UserSummary[] }>(`/me/${which}`) });
  const undo = async (u: UserSummary) => {
    await api.del(`/users/${u.id}/${which === 'blocks' ? 'block' : 'mute'}`);
    void q.refetch();
  };
  return (
    <SettingsPage
      title={which === 'blocks' ? 'Чёрный список' : 'Скрытые авторы'}
      subtitle={which === 'blocks' ? 'Заблокированные не могут писать вам, видеть ваши публикации и подписываться' : 'Их публикации не показываются в ваших лентах; они об этом не узнают'}
      icon={which === 'blocks' ? <UserX size={22} /> : <VolumeX size={22} />}
    >
      <Panel>
        {q.data?.items.length === 0 && <EmptyState icon={<Eye size={26} />} title="Список пуст" />}
        {q.data?.items.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            action={
              <Button size="sm" variant="secondary" onClick={() => void undo(u)}>
                {which === 'blocks' ? 'Разблокировать' : 'Показывать'}
              </Button>
            }
          />
        ))}
      </Panel>
    </SettingsPage>
  );
}
