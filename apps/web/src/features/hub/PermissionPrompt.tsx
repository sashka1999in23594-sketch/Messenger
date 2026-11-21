/**
 * Системные окна поверх размытого рабочего стола: запрос одного разрешения
 * и установка приложения. Каждое разрешение — отдельный вопрос; установка
 * не выдаёт ничего «оптом»: галочки разрешений по умолчанию сняты.
 */
import { useState } from 'react';
import { create } from 'zustand';
import { createPortal } from 'react-dom';
import { BadgeCheck, Camera, FolderLock, Mic, Monitor, ShieldAlert, X } from 'lucide-react';
import { catalogById, PERM_LABEL, VIA_LABEL, type CatalogApp, type Perm } from './catalog';
import { useCloud, type DeskItem, type LivePerm } from './cloud';
import { AppGlyph } from './AppGlyph';
import { useTaste } from './discover';
import { toast } from '../../shared/stores/ui';

type Req =
  | { kind: 'perm'; item: DeskItem; perm: LivePerm; done: (ok: boolean) => void }
  | { kind: 'install'; app: CatalogApp; done: (ok: boolean) => void };

const useReq = create<{ req: Req | null }>(() => ({ req: null }));

export function askPermission(item: DeskItem, perm: LivePerm): Promise<boolean> {
  return new Promise((done) => useReq.setState({ req: { kind: 'perm', item, perm, done } }));
}

export function askInstall(appId: string): Promise<boolean> {
  const app = catalogById.get(appId);
  if (!app) return Promise.resolve(false);
  return new Promise((done) => useReq.setState({ req: { kind: 'install', app, done } }));
}

const PERM_TEXT: Record<LivePerm, { icon: typeof Camera; title: string; text: string }> = {
  camera: { icon: Camera, title: 'камеру', text: 'Пока камера включена, в строке меню горит зелёная точка, а на значке приложения — значок камеры. Выключить можно в любой момент.' },
  mic: { icon: Mic, title: 'микрофон', text: 'Пока микрофон работает, в строке меню горит оранжевая точка. Приложение не может включить его без этого индикатора.' },
  screen: { icon: Monitor, title: 'демонстрацию экрана', text: 'Каждый показ экрана браузер подтверждает отдельно — вы выбираете окно или вкладку сами.' },
};

function close(ok: boolean) {
  const r = useReq.getState().req;
  useReq.setState({ req: null });
  r?.done(ok);
}

function PermBody({ item, perm }: { item: DeskItem; perm: LivePerm }) {
  const t = PERM_TEXT[perm];
  const Icon = t.icon;
  return (
    <>
      <div className="sysdlg__hero sysdlg__hero--perm">
        <span className="sysdlg__pulse">
          <Icon size={30} />
        </span>
      </div>
      <h2 className="sysdlg__title">
        Разрешить «{item.name}» использовать {t.title}?
      </h2>
      <p className="sysdlg__text">{t.text}</p>
      <div className="sysdlg__actions">
        <button type="button" className="btn btn--secondary" onClick={() => close(false)}>
          Не разрешать
        </button>
        <button type="button" className="btn btn--primary" onClick={() => close(true)}>
          Разрешить
        </button>
      </div>
    </>
  );
}

function InstallBody({ app }: { app: CatalogApp }) {
  const [perms, setPerms] = useState<Partial<Record<Perm, boolean>>>({});
  const [ack, setAck] = useState(app.verified);
  return (
    <>
      <div className="sysdlg__app">
        <AppGlyph app={app} size={64} />
        <div>
          <div className="sysdlg__name">{app.name}</div>
          <div className="sysdlg__pub">
            {app.verified ? (
              <span className="sysdlg__ok">
                <BadgeCheck size={15} /> Проверенный издатель: {app.publisher}
              </span>
            ) : (
              <span className="sysdlg__warn">
                <ShieldAlert size={15} /> Издатель не проверен
              </span>
            )}
          </div>
          <div className="sysdlg__via">{VIA_LABEL[app.via]}</div>
        </div>
      </div>
      {!app.verified && (
        <div className="notice notice--warning sysdlg__notice">
          Приложение не прошло проверку Sunnet. Оно будет работать в изоляции и не увидит ваши файлы, чаты и другие приложения — только то, что вы разрешите ниже.
        </div>
      )}
      <div className="sysdlg__section">Что изменится</div>
      <ul className="sysdlg__list">
        <li>На рабочем столе появится значок «{app.name}»</li>
        <li>
          <FolderLock size={14} /> Своя изолированная папка в облаке: <code>/Приложения/{app.name}</code>
        </li>
        {app.via === 'web' && <li>Сервис откроется в своей официальной веб-версии — вход выполняется на сайте сервиса</li>}
        {app.via === 'api' && <li>Подключение через официальный API — вы подтвердите вход на странице сервиса</li>}
      </ul>
      <div className="sysdlg__section">Разрешения — каждое отдельно</div>
      {app.perms.length ? (
        app.perms.map((p) => (
          <label key={p} className="sysdlg__perm">
            <input type="checkbox" checked={!!perms[p]} onChange={(e) => setPerms({ ...perms, [p]: e.target.checked })} />
            <span>{PERM_LABEL[p]}</span>
          </label>
        ))
      ) : (
        <div className="sysdlg__muted">Приложению не нужны разрешения</div>
      )}
      {!app.verified && (
        <label className="sysdlg__perm sysdlg__perm--ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>Я понимаю риски установки непроверенного приложения</span>
        </label>
      )}
      <div className="sysdlg__actions">
        <button type="button" className="btn btn--secondary" onClick={() => close(false)}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ack}
          onClick={() => {
            const item = useCloud.getState().install(app.id);
            for (const [p, on] of Object.entries(perms)) if (on) useCloud.getState().grant(item.id, p as Perm, true);
            useTaste.getState().track(app.cat, 3);
            toast({ text: `«${app.name}» на рабочем столе`, kind: 'success' });
            close(true);
          }}
        >
          Установить
        </button>
      </div>
    </>
  );
}

export function SystemDialogs() {
  const req = useReq((s) => s.req);
  if (!req) return null;
  return createPortal(
    <div className="sysdlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="sysdlg" role="dialog" aria-modal="true">
        <button type="button" className="icon-btn icon-btn--sm sysdlg__x" onClick={() => close(false)} aria-label="Закрыть">
          <X size={16} />
        </button>
        {req.kind === 'perm' ? <PermBody item={req.item} perm={req.perm} /> : <InstallBody app={req.app} />}
      </div>
    </div>,
    document.body,
  );
}
