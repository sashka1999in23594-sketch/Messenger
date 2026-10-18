import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AtSign, Cake, Camera, Download, ImagePlus, PenLine, Phone, Smile, Trash2 } from 'lucide-react';
import { formatPhone, LIMITS, sanitizeName, type Gender, type Me } from '@omni/shared';
import { api, ApiError, errorMessage, uploadFile } from '../../shared/api/client';
import { prepareImage } from '../../shared/lib/media';
import { useMe, useSession } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { Avatar, Button, Input, Notice, PasswordInput, Segmented, SettingRow, Textarea } from '../../shared/ui';
import { leaveSession } from '../../app/session';
import { Panel, SettingsPage } from './common';
import { LinksEditor, StatusDialog } from '../profile/extras';
import '../profile/profile.css';

export function ProfileSettings() {
  const [statusOpen, setStatusOpen] = useState(false);
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [website, setWebsite] = useState(me.website ?? '');
  const [location, setLocation] = useState(me.location ?? '');
  const [birthDate, setBirthDate] = useState(me.birthDate ?? '');
  const [gender, setGender] = useState<Gender>(me.gender ?? 'unspecified');
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
          <Input
            label="Имя"
            value={displayName}
            onChange={(e) => setDisplayName(sanitizeName(e.target.value, LIMITS.displayNameMax))}
            maxLength={LIMITS.displayNameMax}
            hint="Только буквы, цифры, пробел и дефис — без эмодзи"
            error={fields.displayName}
          />
          <Textarea label="Био" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={LIMITS.bioMax} hint={`${bio.length}/${LIMITS.bioMax}`} error={fields.bio} />
          <Input label="Сайт" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" error={fields.website} />
          <Input label="Город" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={LIMITS.locationMax} />
          <Button loading={save.isPending} onClick={() => save.mutate({ displayName, bio, website, location })} style={{ alignSelf: 'flex-start' }}>
            Сохранить
          </Button>
        </div>
      </Panel>
      <Panel
        title="День рождения"
        footer="Дату никто не видит. В ваш день рождения подписчики, контакты и те, с кем вы переписывались, получат напоминание поздравить вас, а мы пришлём письмо и поздравим в чате SpaceUp."
      >
        <div className="col gap-3" style={{ padding: '0 16px 16px' }}>
          <Input label="Дата рождения" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} min="1906-01-01" error={fields.birthDate} />
          <div className="field">
            <span className="field__label">Пол</span>
            <Segmented<Gender>
              value={gender}
              onChange={setGender}
              options={[
                { value: 'male', label: 'Мужской' },
                { value: 'female', label: 'Женский' },
                { value: 'unspecified', label: 'Не указывать' },
              ]}
            />
          </div>
          <Button
            icon={<Cake size={16} />}
            loading={save.isPending}
            disabled={!birthDate}
            onClick={() => save.mutate({ birthDate, gender })}
            style={{ alignSelf: 'flex-start' }}
          >
            Сохранить
          </Button>
        </div>
      </Panel>
      <Panel title="Статус">
        <SettingRow
          icon={<Smile size={18} />}
          tile="tile-yellow"
          title={me.status ? `${me.status.emoji} ${me.status.text || 'Без текста'}` : 'Статус не установлен'}
          description={me.status?.until ? `Исчезнет ${new Date(me.status.until).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'Эмодзи и пара слов рядом с именем — «В отпуске», «Работаю»'}
          onClick={() => setStatusOpen(true)}
        />
      </Panel>
      <Panel title={`Ссылки · до ${LIMITS.profileLinksMax}`} footer="Показываются в профиле. Только http(s) — открываются в новой вкладке без передачи данных о вас.">
        <LinksEditor />
      </Panel>
      {statusOpen && <StatusDialog onClose={() => setStatusOpen(false)} />}
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
    <SettingsPage title="Имя пользователя" subtitle="Ваш уникальный адрес в SpaceUp" icon={<AtSign size={22} />}>
      <Panel footer="Старые ссылки на профиль перестанут работать. Для подтверждения нужен пароль.">
        <div className="col gap-3" style={{ padding: 16 }}>
          <Input label="Имя пользователя" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} error={fields.username} hint={`${location.host}/u/${username}`} />
          <PasswordInput label="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} autoComplete="current-password" />
          <Button disabled={!password || username === me.username} loading={save.isPending} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>
            Сменить
          </Button>
        </div>
      </Panel>
    </SettingsPage>
  );
}

export function PhoneSettings() {
  const me = useMe();
  const setMe = useSession((s) => s.setMe);
  const [phone, setPhone] = useState(me.phone ? formatPhone(me.phone) : '');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put<Me>('/me/phone', { phone, password }),
    onSuccess: (m) => {
      setMe(m);
      setPassword('');
      setFields({});
      toast({ text: 'Номер сохранён', kind: 'success' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      toast({ text: errorMessage(e), kind: 'error' });
    },
  });
  return (
    <SettingsPage title="Номер телефона" subtitle="Для входа и чтобы знакомые нашли вас" icon={<Phone size={22} />}>
      <Panel footer={<>Кто может найти вас по номеру и видеть его — в <Link to="/settings/privacy/phone">настройках приватности</Link>. Для смены номера нужен пароль.</>}>
        <div className="col gap-3" style={{ padding: 16 }}>
          <Input label="Телефон" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" error={fields.phone} />
          <PasswordInput label="Текущий пароль" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} autoComplete="current-password" />
          <Button disabled={!password || !phone.trim()} loading={save.isPending} onClick={() => save.mutate()} style={{ alignSelf: 'flex-start' }}>
            Сохранить
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
          <a className="btn btn--primary" href="/api/v1/account/export" download="spaceup-export.json" style={{ alignSelf: 'flex-start' }}>
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
