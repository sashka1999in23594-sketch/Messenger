import type { ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Audience, Me, NotificationSettings, PrivacySettings } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { PageHeader } from '../../shared/ui';
import './settings.css';

export function SettingsPage({ title, subtitle, icon, children }: { title: string; subtitle?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="scroll">
      <div className="page">
        <PageHeader title={title} subtitle={subtitle} icon={icon} />
        <div className="col gap-4">{children}</div>
      </div>
    </div>
  );
}

export function Panel({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      {title && <div className="panel__title">{title}</div>}
      {children}
      {footer && <div className="panel__footer">{footer}</div>}
    </section>
  );
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: 'Все',
  following: 'Люди, на которых я подписан(а)',
  nobody: 'Никто',
};

export function AudienceSelect({ value, onChange, label }: { value: Audience; onChange: (v: Audience) => void; label: string }) {
  return (
    <div className="audience" role="radiogroup" aria-label={label}>
      {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
        <label key={a} className="list-item audience__option">
          <input type="radio" name={label} checked={value === a} onChange={() => onChange(a)} />
          <span className="list-item__body">{AUDIENCE_LABELS[a]}</span>
        </label>
      ))}
    </div>
  );
}

/** Сохранение настроек приватности с оптимистичным обновлением профиля. */
export function usePrivacy() {
  const me = useSession((s) => s.me)!;
  const patchMe = useSession((s) => s.patchMe);
  const m = useMutation({
    mutationFn: (patch: Partial<PrivacySettings>) => api.patch<PrivacySettings>('/me/privacy', patch),
    onMutate: (patch) => {
      const prev = me.privacy;
      patchMe({ privacy: { ...me.privacy, ...patch } });
      return prev;
    },
    onSuccess: (privacy) => {
      patchMe({ privacy });
      toast({ text: 'Сохранено', kind: 'success' });
    },
    onError: (e, _v, prev) => {
      if (prev) patchMe({ privacy: prev });
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return { privacy: me.privacy, update: m.mutate };
}

export function useNotificationPrefs() {
  const me = useSession((s) => s.me)!;
  const patchMe = useSession((s) => s.patchMe);
  const m = useMutation({
    mutationFn: (patch: Partial<NotificationSettings>) => api.patch<NotificationSettings>('/me/notification-settings', patch),
    onMutate: (patch) => patchMe({ notifications: { ...me.notifications, ...patch } }),
    onSuccess: (notifications) => patchMe({ notifications }),
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return { prefs: me.notifications, update: m.mutate };
}

export function useRefreshMe() {
  const setMe = useSession((s) => s.setMe);
  return async () => setMe(await api.get<Me>('/me'));
}
