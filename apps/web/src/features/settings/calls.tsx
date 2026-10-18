/**
 * Проверка звонков: микрофон и камера, связь с сервером, прямое соединение
 * (STUN) и резервный маршрут через TURN. Показывает, что именно мешает звонку.
 */
import { useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, Mic, Phone, Radio, Router, Server, Video } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { useRealtime } from '../../shared/stores/realtime';
import { Button, Notice } from '../../shared/ui';
import { Panel, SettingsPage } from './common';

type Level = 'ok' | 'warn' | 'fail';
interface Check {
  id: string;
  icon: React.ReactNode;
  title: string;
  level: Level;
  text: string;
}

interface IceConfig {
  iceServers: RTCIceServer[];
  relay: boolean;
  turnSource: 'cloudflare' | 'metered' | 'static' | null;
}

/** Собираем ICE-кандидаты: по их типам видно, какие маршруты доступны. */
async function gather(servers: RTCIceServer[], relayOnly: boolean): Promise<Set<string>> {
  const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
  const types = new Set<string>();
  pc.createDataChannel('probe');
  const done = new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, 7000);
    pc.onicecandidate = (e) => {
      if (e.candidate?.type) types.add(e.candidate.type);
      if (!e.candidate) {
        window.clearTimeout(t);
        resolve();
      }
    };
  });
  await pc.setLocalDescription(await pc.createOffer());
  await done;
  pc.close();
  return types;
}

async function media(kind: 'audio' | 'video'): Promise<Level> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
    stream.getTracks().forEach((t) => t.stop());
    return 'ok';
  } catch (e) {
    return (e as DOMException).name === 'NotFoundError' ? 'warn' : 'fail';
  }
}

const TURN_NAME = { cloudflare: 'Cloudflare', metered: 'Metered', static: 'свой сервер' } as const;

export function CallsSettings() {
  const ws = useRealtime((s) => s.status);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out: Check[] = [];
    const push = (c: Check) => {
      out.push(c);
      setChecks([...out]);
    };
    const mic = await media('audio');
    push({
      id: 'mic',
      icon: <Mic size={18} />,
      title: 'Микрофон',
      level: mic,
      text: mic === 'ok' ? 'Доступ есть' : mic === 'warn' ? 'Микрофон не найден — подключите гарнитуру' : 'Доступ запрещён — разрешите микрофон для этого сайта в настройках браузера',
    });
    const cam = await media('video');
    push({ id: 'cam', icon: <Video size={18} />, title: 'Камера', level: cam === 'fail' ? 'warn' : cam, text: cam === 'ok' ? 'Доступ есть' : 'Недоступна — звонки будут только голосовые' });
    push({
      id: 'ws',
      icon: <Server size={18} />,
      title: 'Связь с сервером',
      level: ws === 'online' ? 'ok' : 'fail',
      text: ws === 'online' ? 'Сигналы звонка доходят мгновенно' : 'Нет соединения — проверьте интернет и обновите страницу',
    });
    let cfg: IceConfig;
    try {
      cfg = await api.get<IceConfig>('/calls/config');
    } catch (e) {
      push({ id: 'cfg', icon: <Router size={18} />, title: 'Настройки соединения', level: 'fail', text: errorMessage(e) });
      setRunning(false);
      return;
    }
    const all = await gather(cfg.iceServers, false);
    push({
      id: 'stun',
      icon: <Router size={18} />,
      title: 'Прямое соединение',
      level: all.has('srflx') ? 'ok' : all.size ? 'warn' : 'fail',
      text: all.has('srflx')
        ? 'Внешний адрес определён — с большинством сетей звонок соединится напрямую'
        : 'Сеть не пропускает прямые соединения (UDP закрыт) — звонок возможен только через резервный маршрут',
    });
    if (!cfg.relay) {
      push({
        id: 'turn',
        icon: <Radio size={18} />,
        title: 'Резервный маршрут (TURN)',
        level: 'fail',
        text: 'Не подключён. Без него звонки между разными сетями (мобильный интернет ↔ Wi-Fi) часто не соединяются',
      });
    } else {
      const relay = await gather(cfg.iceServers, true);
      push({
        id: 'turn',
        icon: <Radio size={18} />,
        title: 'Резервный маршрут (TURN)',
        level: relay.has('relay') ? 'ok' : 'fail',
        text: relay.has('relay')
          ? `Работает (${cfg.turnSource ? TURN_NAME[cfg.turnSource] : 'TURN'}) — звонок соединится в любой сети`
          : 'Подключён, но не отвечает — проверьте ключи TURN на сервере',
      });
    }
    setRunning(false);
  };

  const turnMissing = checks?.some((c) => c.id === 'turn' && c.level === 'fail');
  return (
    <SettingsPage title="Звонки" subtitle="Проверка микрофона, камеры и сети" icon={<Phone size={22} />}>
      <Panel title="Проверка связи" footer="Проверка занимает несколько секунд и ничего не отправляет собеседникам.">
        <div style={{ padding: 16 }}>
          <Button loading={running} onClick={() => void run()}>
            {checks ? 'Проверить ещё раз' : 'Проверить звонки'}
          </Button>
        </div>
        {checks?.map((c) => (
          <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className="list-item__icon">{c.icon}</span>
            <span className="list-item__body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="list-item__title">{c.title}</span>
              <span className="list-item__sub" style={{ whiteSpace: 'normal' }}>
                {c.text}
              </span>
            </span>
            {c.level === 'ok' ? (
              <CheckCircle2 size={20} style={{ color: 'var(--success)' }} aria-label="В порядке" />
            ) : c.level === 'warn' ? (
              <CircleAlert size={20} style={{ color: 'var(--warning)' }} aria-label="Есть ограничения" />
            ) : (
              <CircleX size={20} style={{ color: 'var(--danger)' }} aria-label="Не работает" />
            )}
          </div>
        ))}
      </Panel>
      {turnMissing && (
        <Notice kind="warning">
          Владелец сервера подключает резервный маршрут один раз: бесплатный TURN от Cloudflare (Realtime → TURN Server) — переменные окружения <code>CF_TURN_KEY_ID</code> и{' '}
          <code>CF_TURN_API_TOKEN</code>. Подробно — в README, раздел «Звонки».
        </Notice>
      )}
    </SettingsPage>
  );
}
