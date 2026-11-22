/**
 * Окно установки (как в Windows): стол размывается, по центру — что ставим,
 * кто издатель, проверен ли он, какие разрешения просит приложение, что изменится
 * и какие компоненты появятся. Подтверждение не даёт доступа ко всему облаку:
 * приложение получает только перечисленное. История установок хранится на устройстве.
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AlertTriangle, BadgeCheck, FolderLock, Globe, MonitorDown, ShieldCheck, X } from 'lucide-react';
import { createItem } from '../desktop/cloud';
import './installer.css';

export interface InstallTarget {
  name: string;
  url: string;
  publisher: string;
  verified: boolean;
  kind: 'web' | 'studio';
  permissions?: string[];
}

const HISTORY = 'sunnet-install-history';
export function installHistory(): { name: string; publisher: string; at: number }[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY) ?? '[]') as { name: string; publisher: string; at: number }[];
  } catch {
    return [];
  }
}

const PERM_TEXT: Record<string, string> = {
  notifications: 'Показывать уведомления — спросим при первом уведомлении',
  files: 'Файлы — только те, что вы сами выберете',
  camera: 'Камера — спросим при первом использовании, всегда с индикатором',
  microphone: 'Микрофон — спросим при первом использовании, всегда с индикатором',
  screen: 'Показ экрана — подтверждение каждый раз',
};

function Dialog({ t, done }: { t: InstallTarget; done: (ok: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'ask' | 'installing' | 'ok'>('ask');
  const install = async () => {
    setBusy(true);
    setStage('installing');
    const item = await createItem({ kind: 'link', name: t.name, url: t.url });
    if (!item) return done(false);
    try {
      localStorage.setItem(HISTORY, JSON.stringify([{ name: t.name, publisher: t.publisher, at: Date.now() }, ...installHistory()].slice(0, 100)));
    } catch {
      /* история — удобство, не обязательна */
    }
    setStage('ok');
    setTimeout(() => done(true), 900);
  };
  return (
    <div className="inst" role="dialog" aria-modal="true" aria-label={`Установка ${t.name}`}>
      <div className="inst__card">
        <button type="button" className="inst__x" aria-label="Отмена" onClick={() => done(false)}>
          <X size={18} />
        </button>
        <header className="inst__head">
          <span className="inst__icon">{t.name.slice(0, 1)}</span>
          <div>
            <h2>Установить «{t.name}»?</h2>
            <div className="inst__pub">
              {t.publisher}
              {t.verified ? (
                <span className="inst__badge inst__badge--ok">
                  <BadgeCheck size={14} /> Издатель проверен
                </span>
              ) : (
                <span className="inst__badge inst__badge--warn">
                  <AlertTriangle size={14} /> Издатель не проверен
                </span>
              )}
            </div>
          </div>
        </header>
        {!t.verified && (
          <p className="inst__warn">Это приложение не проходило проверку Sunnet. Устанавливайте, только если доверяете автору. Оно будет работать в изолированной песочнице и не увидит ваши файлы, чаты и аккаунт.</p>
        )}
        <h3>Разрешения — каждое отдельно</h3>
        <ul className="inst__list">
          {(t.permissions?.length ? t.permissions : []).map((p) => (
            <li key={p}>
              <ShieldCheck size={15} /> {PERM_TEXT[p] ?? p}
            </li>
          ))}
          {!t.permissions?.length && (
            <li>
              <ShieldCheck size={15} /> Никаких — {t.kind === 'web' ? 'сервис открывается своей официальной страницей и не получает доступа к Sunnet' : 'приложению ничего не нужно'}
            </li>
          )}
        </ul>
        <h3>Что изменится</h3>
        <ul className="inst__list">
          <li>
            <MonitorDown size={15} /> Значок «{t.name}» на рабочем столе — виден на всех ваших устройствах
          </li>
          <li>
            <FolderLock size={15} /> Доступ к файлам: нет — ваши файлы и другие приложения не затрагиваются
          </li>
          <li>
            <Globe size={15} /> Компоненты: {t.kind === 'web' ? 'ярлык на официальную веб-версию' : 'приложение Студии, запуск в песочнице'}
          </li>
        </ul>
        <footer className="inst__foot">
          <span>Удалить можно в любой момент — правый клик по значку → «В корзину». Ваши файлы при этом не удаляются.</span>
          <button type="button" className="inst__cancel" onClick={() => done(false)}>
            Отмена
          </button>
          <button type="button" className="inst__ok" disabled={busy} onClick={() => void install()}>
            {stage === 'installing' ? 'Устанавливаем…' : stage === 'ok' ? 'Готово' : 'Установить'}
            {stage !== 'ask' && <span className="inst__bar" aria-hidden />}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Показать окно установки; true — установлено. */
export function openInstaller(t: InstallTarget): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      host.classList.add('inst-closing');
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 220);
      resolve(ok);
    };
    root.render(<Dialog t={t} done={done} />);
  });
}
