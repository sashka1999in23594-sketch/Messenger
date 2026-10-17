import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AtSign, Camera, Download, ImagePlus, PenLine, Trash2 } from 'lucide-react';
import { LIMITS, type Me } from '@omni/shared';
import { api, ApiError, errorMessage, uploadFile } from '../../shared/api/client';
import { prepareImage } from '../../shared/lib/media';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, Input, Notice, PasswordInput, Textarea } from '../../shared/ui';
import { leaveSession } from '../../app/session';
import { Panel, SettingsPage } from './common';
import '../profile/profile.css';

export function ProfileSettings() {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [website, setWebsite] = useState(me.website ?? '');
  const [location, setLocation] = useState(me.location ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<Me>('/me/profile', patch),
    onSuccess: (m) => {
      setMe(m);
      setFields({});
      toast({ text: 'Профиль обновлён', kind: 'success' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });

  const uploadImage = async (file: File, kind: 'avatar' | 'banner') => {
    setUploading(kind);
    try {
      const img = await prepareImage(file, kind === 'avatar' ? 800 : 2000);
      const media = await uploadFile(img.blob, img.name, { width: img.width, height: img.height });
      save.mutate(kind === 'avatar' ? { avatarMediaId: media.id } : { bannerMediaId: media.id });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setUploading(null);
    }
  };

  return (
    <SettingsPage title="Профиль" subtitle="Так вас видят другие" icon={<PenLine size={22} />}>
      <Panel>
        <div
          className="profile__banner"
          style={{ height: 140, cursor: 'pointer', position: 'relative', ...(me.bannerUrl ? { backgroundImage: `url("${me.bannerUrl}")` } : {}) }}
          onClick={() => bannerInput.current?.click()}
        >
          <span className="tag" style={{ position: 'absolute', right: 12, bottom: 12, background: 'rgba(0,0,0,.55)', color: '#fff' }}>
            <ImagePlus size={14} /> {uploading === 'banner' ? 'Загрузка…' : 'Сменить обложку'}
          </span>
        </div>
        <div className="row" style={{ padding: 16, gap: 16 }}>
          <button onClick={() => avatarInput.current?.click()} style={{ position: 'relative' }} aria-label="Сменить фото">
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={88} />
            <span className="badge" style={{ position: 'absolute', right: 0, bottom: 0, width: 30, height: 30 }}>
              <Camera size={16} />
            </span>
          </button>
          <div className="col" style={{ gap: 2 }}>
            <span className="bold">{uploading === 'avatar' ? 'Загрузка…' : 'Фото профиля'}</span>
            <span className="small muted">Фото сжимается на устройстве, метаданные (включая геолокацию) удаляются</span>
            {me.avatarUrl && (
              <button className="btn btn--ghost btn--sm" style={{ paddingLeft: 0, alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => save.mutate({ avatarMediaId: null })}>
                Удалить фото
              </button>
            )}
          </div>
        </div>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0], 'avatar')} />
        <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0], 'banner')} />
      </Panel>
      <Panel title="О себе">
        <div className="col gap-3" style={{ padding: '0 16px 16px' }}>
          <Input label="Имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={LIMITS.displayNameMax} error={fields.displayName} />
          <Textarea label="Био" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bioMax} hint={`${bio.length}/${LIMITS.bioMax}`} error={fields.bio} />
          <Input label="Сайт" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" error={fields.website} />
          <Input label="Город" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={LIMITS.locationMax} />
          <Button loading={save.isPending} onClick={() => save.mutate({ displayName, bio, website, location })} style={{ alignSelf: 'flex-start' }}>
            Сохранить
          </Button>
        </div>
      </Panel>
    </SettingsPage>
  );
}

export function UsernameSettings() {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [username, setUsername] = useState(me.username);
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post<Me>('/security/username', { username, password }),
    onSuccess: (m) => {
      setMe(m);
      setPassword('');
      toast({ text: 'Имя пользователя изменено', kind: 'success' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return (
    <SettingsPage title="Имя пользователя" subtitle="Ваш уникальный адрес в Omni" icon={<AtSign size={22} />}>
      <Panel footer="Старые ссылки на профиль перестанут работать. Для подтверждения нужен пароль.">
        <div className="col gap-3" style={{ padding: 16 }}>
          <Input label="Имя пользователя" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} error={fields.username} hint={`omni.app/u/${username}`} />
          <PasswordInput label="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} autoComplete="current-password" />
          <Button disabled={!password || username === me.username} loading={save.isPending} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>
            Сменить
          </Button>
        </div>
      </Panel>
    </SettingsPage>
  );
}

export function ExportSettings() {
  return (
    <SettingsPage title="Экспорт данных" subtitle="Право на копию своих данных" icon={<Download size={22} />}>
      <Panel footer="Содержимое секретных чатов не экспортируется: сервер его не знает. Файл содержит личные данные — храните его бережно.">
        <div className="col gap-3" style={{ padding: 16 }}>
          <p>Вы получите JSON-файл с профилем, публикациями, комментариями, подписками, сообщениями из обычных чатов и журналом безопасности.</p>
          <a className="btn btn--primary" href="/api/v1/account/export" download="omni-export.json" style={{ alignSelf: 'flex-start' }}>
            <Download size={18} /> Скачать архив
          </a>
        </div>
      </Panel>
    </SettingsPage>
  );
}

export function DeleteAccountSettings() {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => api.post('/account/delete', { password, confirm: confirmText }),
    onSuccess: () => {
      toast({ text: 'Аккаунт удалён', kind: 'success' });
      leaveSession();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  return (
    <SettingsPage title="Удаление аккаунта" icon={<Trash2 size={22} />}>
      <Notice kind="danger">
        Действие необратимо: профиль, публикации, комментарии и истории будут удалены, все сеансы — завершены. Перед удалением можно{' '}
        <Link to="/settings/account/export">скачать свои данные</Link>.
      </Notice>
      <Panel>
        <div className="col gap-3" style={{ padding: 16 }}>
          <PasswordInput label="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Input label="Введите слово УДАЛИТЬ" value={confirmText} onChange={(e) => setConfirm(e.target.value)} />
          <Button variant="danger" disabled={!password || confirmText !== 'УДАЛИТЬ'} loading={remove.isPending} onClick={() => remove.mutate()} style={{ alignSelf: 'flex-start' }}>
            Удалить аккаунт навсегда
          </Button>
        </div>
      </Panel>
    </SettingsPage>
  );
}
