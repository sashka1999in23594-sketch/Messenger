/**
 * Консоль администратора: команды вида /user.block("ник", duration: 7d).
 * Права проверяет сервер; каждая команда попадает в журнал аудита.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../../shared/api/client';
import './console.css';

interface Line {
  kind: 'in' | 'ok' | 'fail';
  text: string;
}

export function AdminConsole() {
  const cmds = useQuery({ queryKey: ['admin-commands'], queryFn: () => api.get<{ role: string; commands: { usage: string; text: string }[] }>('/admin/console/commands'), retry: false });
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const hints = value.startsWith('/') ? (cmds.data?.commands ?? []).filter((c) => c.usage.startsWith(value.split('(')[0]!)).slice(0, 5) : [];

  const run = async () => {
    const command = value.trim();
    if (!command || busy) return;
    setBusy(true);
    setHist((h) => [command, ...h].slice(0, 50));
    setHi(-1);
    setValue('');
    setLines((l) => [...l, { kind: 'in', text: command }]);
    try {
      const r = await api.post<{ ok: boolean; lines: string[] }>('/admin/console', { command });
      setLines((l) => [...l, ...r.lines.map((text) => ({ kind: r.ok ? ('ok' as const) : ('fail' as const), text }))]);
    } catch (e) {
      setLines((l) => [...l, { kind: 'fail', text: errorMessage(e) }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void run();
    else if (e.key === 'Tab' && hints[0]) {
      e.preventDefault();
      setValue(hints[0].usage.replace(/\(.*$/, '("'));
    } else if (e.key === 'ArrowUp' && hist.length) {
      e.preventDefault();
      const n = Math.min(hi + 1, hist.length - 1);
      setHi(n);
      setValue(hist[n]!);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const n = hi - 1;
      setHi(n);
      setValue(n >= 0 ? hist[n]! : '');
    }
  };

  if (cmds.isError)
    return (
      <div className="acon acon--denied">
        <div className="acon__denied">Консоль доступна только администраторам и модераторам.</div>
      </div>
    );

  return (
    <div className="acon">
      <div className="acon__main">
        <div className="acon__log" role="log" aria-live="polite">
          <div className="acon__hello">Консоль Sunnet · роль: {cmds.data?.role ?? '…'} · все команды записываются в журнал</div>
          {lines.map((l, i) => (
            <div key={i} className={`acon__line acon__line--${l.kind}`}>
              {l.kind === 'in' ? <span className="acon__prompt">sunnet ›</span> : <span className="acon__mark">{l.kind === 'ok' ? '✓' : '!'}</span>}
              {l.text}
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="acon__input">
          <span className="acon__prompt">sunnet ›</span>
          <input
            id="admin-console-input"
            aria-label="Команда"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            placeholder='/user.block("ник", duration: 7d)'
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          {hints.length > 0 && (
            <ul className="acon__hints">
              {hints.map((h) => (
                <li key={h.usage}>
                  <b>{h.usage}</b>
                  <span>{h.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <aside className="acon__side">
        <h2>Команды</h2>
        <ul>
          {(cmds.data?.commands ?? []).map((c) => (
            <li key={c.usage}>
              <button type="button" onClick={() => setValue(c.usage)}>
                <code>{c.usage}</code>
                <span>{c.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
