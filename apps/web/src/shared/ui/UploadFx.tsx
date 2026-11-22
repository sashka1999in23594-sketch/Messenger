/**
 * Анимация загрузки для всего Sunnet: файлик летит по изогнутой стрелке в облако,
 * над дугой — процент. Готово — облако «ловит» файл и показывает галочку.
 * Данные берёт из useUploads, куда попадает любой вызов uploadFile.
 */
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useUploads } from '../stores/uploads';
import { cn } from '../lib/format';
import './upload-fx.css';

const ARC = 'M 22 62 C 60 4, 150 4, 190 50';

export function UploadFx() {
  const jobs = useUploads((s) => s.jobs);
  if (!jobs.length) return null;
  const active = jobs.filter((j) => j.state === 'up');
  const job = active[0] ?? jobs[jobs.length - 1]!;
  const total = active.length ? active.reduce((a, j) => a + j.progress, 0) / active.length : job.progress;
  const pct = Math.round((active.length ? total : job.progress) * 100);
  const ext = (job.name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
  return createPortal(
    <div className={cn('upfx', `upfx--${job.state}`)} role="status" aria-live="polite" style={{ '--p': active.length ? total : job.progress } as CSSProperties}>
      <div className="upfx__pct">{job.state === 'error' ? 'Ошибка' : job.state === 'done' && !active.length ? 'Готово' : `${pct}%`}</div>
      <svg className="upfx__scene" viewBox="0 0 240 80" aria-hidden>
        <defs>
          <linearGradient id="upfx-arc" x1="0" x2="1">
            <stop offset="0%" stopColor="#ffb341" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <path className="upfx__track" d={ARC} pathLength={100} />
        <path className="upfx__fill" d={ARC} pathLength={100} stroke="url(#upfx-arc)" />
        {/* Наконечник стрелки у облака */}
        <path className="upfx__head" d="M 180 37 L 191 50 L 175 52" />
        {/* Облако */}
        <g className="upfx__cloud">
          <path d="M 196 66 h 30 a 11 11 0 0 0 0 -22 a 15 15 0 0 0 -28 -4 a 10 10 0 0 0 -2 26 z" />
          <path className="upfx__tick" d="M 203 55 l 6 6 l 11 -12" />
        </g>
      </svg>
      {/* Файлик летит по дуге (CSS motion path) */}
      <span className="upfx__file" aria-hidden>
        <span>{ext || 'FILE'}</span>
      </span>
      <div className="upfx__name ellipsis">
        {job.name}
        {active.length > 1 && <b> и ещё {active.length - 1}</b>}
      </div>
    </div>,
    document.body,
  );
}
