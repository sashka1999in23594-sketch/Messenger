/**
 * «Скачать»: приложения для Windows, macOS и Linux (сборки — в релизах на
 * GitHub) и установка из браузера как приложения (PWA).
 */
import { useEffect, useMemo, useState } from 'react';
import { Apple, Download, Laptop, Lock, Monitor, MonitorSmartphone, Terminal } from 'lucide-react';
import { useSession } from '../../shared/stores/session';
import { Button } from '../../shared/ui';
import { cn } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { AuthLayout, AuthLinks, HELP_LINK, PARTNERS_LINK, StepTitle } from './ui';

const RELEASES = 'https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download';

type Os = 'windows' | 'mac' | 'linux';
interface Build {
  os: Os;
  title: string;
  note: string;
  file: string;
}

const BUILDS: Build[] = [
  { os: 'windows', title: 'Windows', note: 'Windows 10 и 11 · установщик .exe', file: 'Sunnet-Setup.exe' },
  { os: 'mac', title: 'macOS — Apple Silicon', note: 'Mac на M1, M2, M3, M4 · .dmg', file: 'Sunnet-mac-arm64.dmg' },
  { os: 'mac', title: 'macOS — Intel', note: 'Mac с процессором Intel · .dmg', file: 'Sunnet-mac-x64.dmg' },
  { os: 'linux', title: 'Linux — AppImage', note: 'Любой дистрибутив, без установки', file: 'Sunnet.AppImage' },
  { os: 'linux', title: 'Linux — .deb', note: 'Ubuntu, Debian, Mint', file: 'sunnet_amd64.deb' },
];

const ICONS: Record<Os, typeof Monitor> = { windows: Monitor, mac: Apple, linux: Terminal };

function detectOs(): Os | 'mobile' | null {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'mobile';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/.test(ua)) return 'linux';
  return null;
}

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function DownloadPage() {
  const authed = useSession((s) => s.status === 'authenticated');
  const os = useMemo(detectOs, []);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  // Скачивание только после согласия с политикой и условиями
  const [agreed, setAgreed] = useState(false);
  const gate = (e: React.MouseEvent) => {
    if (!agreed) {
      e.preventDefault();
      toast('Поставьте галочку согласия, чтобы скачать');
    }
  };

  // Установка из браузера (Chrome, Edge, Яндекс): браузер сам предлагает событие
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const primary = os && os !== 'mobile' ? BUILDS.find((b) => b.os === os)! : null;
  const others = BUILDS.filter((b) => b !== primary);
  const PrimaryIcon = primary ? ICONS[primary.os] : Laptop;

  return (
    <AuthLayout
      links={
        <AuthLinks
          items={[
            authed ? { label: 'Открыть Sunnet', to: '/' } : { label: 'Войти', to: '/login' },
            !authed && { label: 'Создать аккаунт', to: '/signup' },
            PARTNERS_LINK,
            HELP_LINK,
          ]}
        />
      }
    >
      <div className="auth__form auth__step">
        <StepTitle title="Скачать Sunnet" text="Отдельное окно, уведомления, звонки и демонстрация экрана — как в настоящем мессенджере" />
        <label className={cn('dl__gate', agreed && 'dl__gate--on')}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} aria-label="Согласие с политикой и условиями" />
          <span>
            Скачивая, я соглашаюсь с{' '}
            <a href="/help/privacy" target="_blank" rel="noopener noreferrer">
              Политикой конфиденциальности
            </a>{' '}
            и{' '}
            <a href="/help/terms" target="_blank" rel="noopener noreferrer">
              Условиями использования
            </a>
            .
          </span>
        </label>
        {primary ? (
          <a className={cn('dl__primary', !agreed && 'dl--locked')} href={`${RELEASES}/${primary.file}`} download aria-disabled={!agreed} onClick={gate}>
            {agreed ? <PrimaryIcon size={26} /> : <Lock size={22} />}
            <span className="col" style={{ gap: 2, minWidth: 0 }}>
              <b>Скачать для {primary.os === 'mac' ? 'macOS' : primary.title}</b>
              <span className="dl__note">{primary.note}</span>
            </span>
            <Download size={20} className="dl__arrow" />
          </a>
        ) : (
          <div className="auth__hint">
            <MonitorSmartphone size={18} />
            <span>
              Приложения для телефона пока нет — но Sunnet можно поставить на экран «Домой»: в Safari нажмите «Поделиться» → «На экран Домой», в Chrome — меню ⋮ →
              «Установить приложение».
            </span>
          </div>
        )}
        <div className="dl__list" role="list">
          <span className="auth__label">{primary ? 'Другие системы' : 'Для компьютера'}</span>
          {others.map((b) => {
            const Icon = ICONS[b.os];
            return (
              <a key={b.file} role="listitem" className={cn('dl__item', !agreed && 'dl--locked')} href={`${RELEASES}/${b.file}`} download aria-disabled={!agreed} onClick={gate}>
                <Icon size={18} />
                <span className="col" style={{ gap: 0, minWidth: 0 }}>
                  <span className="dl__title">{b.title}</span>
                  <span className="dl__note">{b.note}</span>
                </span>
                <Download size={16} className="dl__arrow" />
              </a>
            );
          })}
        </div>
        {install && !installed && (
          <Button
            variant="secondary"
            block
            disabled={!agreed}
            icon={<Laptop size={18} />}
            onClick={async () => {
              await install.prompt();
              if ((await install.userChoice).outcome === 'accepted') setInstalled(true);
              setInstall(null);
            }}
          >
            Установить из браузера
          </Button>
        )}
        <p className="auth__consent">
          Приложения бесплатные и не подписаны платным сертификатом, поэтому при первом запуске система может предупредить о неизвестном разработчике.{' '}
          <a href="/help#desktop">Как открыть</a>
        </p>
      </div>
    </AuthLayout>
  );
}
