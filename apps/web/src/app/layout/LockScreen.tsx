import { useEffect, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { checkPasscode, useLock } from '../../shared/lib/passcode';
import { usePrefs } from '../../shared/stores/prefs';
import { logout } from '../session';

/** Экран блокировки по код-паролю + автоблокировка при бездействии. */
export function LockScreen() {
  const passcode = usePrefs((s) => s.passcode);
  const { locked, lock, unlock } = useLock();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  // Блокировка при запуске и по таймауту бездействия
  useEffect(() => {
    if (!passcode) return;
    lock();
  }, [passcode?.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!passcode || locked) return;
    let timer = setTimeout(lock, passcode.timeoutMin * 60_000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, passcode.timeoutMin * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [passcode, locked, lock]);

  useEffect(() => {
    if (!passcode || code.length < 4) return;
    let cancelled = false;
    setBusy(true);
    void checkPasscode(code, passcode).then((ok) => {
      if (cancelled) return;
      setBusy(false);
      if (ok) {
        unlock();
        setCode('');
      } else if (code.length >= 6) {
        setError(true);
        setTimeout(() => {
          setCode('');
          setError(false);
        }, 600);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, passcode, unlock]);

  useEffect(() => {
    if (!locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setCode((c) => (c.length < 6 ? c + e.key : c));
      if (e.key === 'Backspace') setCode((c) => c.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked]);

  if (!passcode || !locked) return null;
  return (
    <div className="lock-screen" role="dialog" aria-label="Приложение заблокировано">
      <Lock size={36} className="faint" />
      <h2>Введите код-пароль</h2>
      <div className="lock-screen__dots" style={error ? { animation: 'shimmer .3s' } : undefined}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} data-filled={i < code.length} style={error ? { borderColor: 'var(--danger)' } : undefined} />
        ))}
      </div>
      <div className="lock-screen__pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) =>
          k === '' ? (
            <span key="empty" />
          ) : (
            <button
              key={k}
              disabled={busy}
              aria-label={k === 'del' ? 'Стереть' : k}
              onClick={() => (k === 'del' ? setCode((c) => c.slice(0, -1)) : setCode((c) => (c.length < 6 ? c + k : c)))}
            >
              {k === 'del' ? <Delete size={24} style={{ margin: 'auto' }} /> : k}
            </button>
          ),
        )}
      </div>
      <button
        className="btn btn--ghost btn--sm"
        onClick={() => {
          usePrefs.getState().set({ passcode: null });
          unlock();
          void logout();
        }}
      >
        Забыли код? Выйти из аккаунта
      </button>
    </div>
  );
}
