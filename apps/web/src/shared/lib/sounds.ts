/**
 * Короткие звуки интерфейса на WebAudio (без файлов): входящее сообщение,
 * отправка, уведомление. Учитывают настройки звука и «Не беспокоить».
 */
import { isQuietNow, usePrefs } from '../stores/prefs';

type Sound = 'message' | 'sent' | 'notify' | 'test';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function playSound(kind: Sound): void {
  const { sounds, quietHours } = usePrefs.getState();
  if (!sounds) return;
  if (kind === 'sent' && !sounds.sent) return;
  if ((kind === 'message' || kind === 'notify') && (!sounds.messages || isQuietNow(quietHours))) return;
  const c = audio();
  if (!c) return;
  const v = Math.max(0, Math.min(1, sounds.volume ?? 0.6)) * 0.25;
  if (!v) return;
  const t = c.currentTime + 0.01;
  if (kind === 'sent') {
    tone(c, t, 660, 0.09, v * 0.6, 'triangle');
    tone(c, t + 0.05, 990, 0.12, v * 0.5, 'triangle');
  } else if (kind === 'notify') {
    tone(c, t, 784, 0.18, v);
    tone(c, t + 0.12, 1175, 0.28, v * 0.8);
  } else {
    // «Капля»: короткий двухтоновый сигнал
    tone(c, t, 880, 0.14, v);
    tone(c, t + 0.09, 1320, 0.22, v * 0.7);
  }
}

/** Системное уведомление, если вкладка в фоне и пользователь разрешил */
export function desktopNotify(title: string, body: string, onClick?: () => void): void {
  const { desktopNotify: enabled, quietHours } = usePrefs.getState();
  if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden || isQuietNow(quietHours)) return;
  try {
    const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Некоторые браузеры разрешают уведомления только из service worker
  }
}
