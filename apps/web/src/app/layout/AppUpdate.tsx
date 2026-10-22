/**
 * Приложение для компьютера старой версии (без встроенного обновления):
 * один раз за запуск предлагаем поставить новую — с окном обновлений,
 * экраном загрузки и ярлыками Sunnet/Lynnet. Новые версии обновляются сами.
 */
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Logo, Modal } from '../../shared/ui';

/** Последняя версия приложения для компьютера (desktop-app/package.json) */
export const DESKTOP_LATEST = '1.3.1';
/** С этой версии Windows и Linux обновляются сами */
const SELF_UPDATING = '1.2.0';
const RELEASES = 'https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download';
const KEY = 'sunnet.app-update.dismissed';

const parse = (v: string) => v.split('.').map(Number);
function older(a: string, b: string): boolean {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

function installed(): { version: string; os: 'windows' | 'mac' | 'linux' } | null {
  if (typeof navigator === 'undefined') return null;
  const m = navigator.userAgent.match(/(?:Sunnet|SpaceUp)\/(\d+\.\d+\.\d+)/);
  if (!m?.[1]) return null;
  const os = /Windows/.test(navigator.userAgent) ? 'windows' : /Mac OS X/.test(navigator.userAgent) ? 'mac' : 'linux';
  return { version: m[1], os };
}

function needsManualUpdate(): ReturnType<typeof installed> {
  const app = installed();
  if (!app || !older(app.version, DESKTOP_LATEST)) return null;
  // Windows и Linux с версии 1.2.0 обновляются сами при запуске
  if (app.os !== 'mac' && !older(app.version, SELF_UPDATING)) return null;
  try {
    if (sessionStorage.getItem(KEY) === DESKTOP_LATEST) return null;
  } catch {
    // нет хранилища — просто покажем
  }
  return app;
}

export function AppUpdate() {
  const [app, setApp] = useState(needsManualUpdate);
  if (!app) return null;
  const close = () => {
    try {
      sessionStorage.setItem(KEY, DESKTOP_LATEST);
    } catch {
      // не запомнили — покажем в следующий раз
    }
    setApp(null);
  };
  const file = app.os === 'windows' ? 'Sunnet-Setup.exe' : app.os === 'linux' ? 'Sunnet.AppImage' : null;
  const href = file ? `${RELEASES}/${file}` : '/download';
  return (
    <Modal open onClose={close} title="Вышла новая версия приложения" sheet={false}>
      <div className="app-update">
        <Logo size={72} />
        <p className="app-update__text">
          У вас Sunnet {app.version}, доступна {DESKTOP_LATEST}: окно запуска с солнцем, обновления сами — без браузера, запуск вместе с системой и ярлыки, которые ночью
          становятся Lynnet.
        </p>
        <p className="app-update__note">
          {file ? 'Скачайте установщик и запустите его — старая версия заменится, настройки и вход сохранятся. Дальше обновления будут ставиться сами.' : 'Скачайте файл для вашего Mac и перетащите Sunnet в «Программы».'}
        </p>
        <div className="app-update__actions">
          <button type="button" className="btn btn--secondary" onClick={close}>
            Позже
          </button>
          <a className="btn btn--primary" href={href} target="_blank" rel="noreferrer" onClick={close}>
            <Download size={17} /> Скачать {DESKTOP_LATEST}
          </a>
        </div>
      </div>
    </Modal>
  );
}
