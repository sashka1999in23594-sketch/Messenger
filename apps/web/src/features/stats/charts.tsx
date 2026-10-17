/**
 * Графики статистики на SVG без библиотек: линия с заливкой (как курс в
 * криптобирже), столбцы и спарклайн. Подсказка при наведении и с клавиатуры
 * (стрелки), у каждого графика есть таблица с теми же числами.
 */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../shared/lib/format';

const fmt = new Intl.NumberFormat('ru-RU');
export const num = (n: number) => fmt.format(Math.round(n));

/** Подпись дня: «17 окт» */
export function dayShort(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(160, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** «Круглые» деления оси: 0, 5, 10… или 0, 1 тыс., 2 тыс. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) max = min + 1;
  // Счётчики целые: шаг не меньше единицы и без «2,5»
  const raw = Math.max(1, (max - min) / count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

const tick = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10} тыс.`.replace('.', ',') : num(n));

/** Изменение за период: стрелка, знак и проценты — цвет дублируется значком. */
export function Delta({ from, to, invert, suffix }: { from: number; to: number; invert?: boolean; suffix?: string }) {
  const diff = to - from;
  const pct = from ? (diff / from) * 100 : to ? 100 : 0;
  const good = invert ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn('delta', diff === 0 ? 'delta--flat' : good ? 'delta--up' : 'delta--down')}>
      <Icon size={14} aria-hidden />
      {diff > 0 ? '+' : diff < 0 ? '−' : ''}
      {num(Math.abs(diff))}
      {from > 0 && ` (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0).replace('.', ',')}%)`}
      {suffix && <span className="delta__suffix"> {suffix}</span>}
    </span>
  );
}

function DataTable({ days, rows }: { days: string[]; rows: { label: string; values: number[] }[] }) {
  return (
    <details className="chart-table">
      <summary>Таблица</summary>
      <div className="chart-table__scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">День</th>
              {rows.map((r) => (
                <th key={r.label} scope="col">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days
              .map((d, i) => (
                <tr key={d}>
                  <th scope="row">{dayShort(d)}</th>
                  {rows.map((r) => (
                    <td key={r.label}>{num(r.values[i] ?? 0)}</td>
                  ))}
                </tr>
              ))
              .reverse()}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

interface Hover {
  i: number;
  x: number;
}

/** Линия с заливкой и перекрестием: наводите — видно значение на любую дату. */
export function AreaChart({ days, values, label, height = 240 }: { days: string[]; values: number[]; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const gid = useId().replace(/:/g, '');
  const n = values.length;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Ось не обязательно от нуля: как у курса — видно колебания, но шкала честно подписана
  const span = hi - lo;
  const ticks = niceTicks(Math.max(0, lo - span * 0.15), hi + span * 0.1 || hi + 1);
  const y0 = ticks[0]!;
  const y1 = ticks.at(-1)!;
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${PAD.top + ih} L${x(0).toFixed(1)},${PAD.top + ih} Z`;
  const labelIdx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const rel = ((clientX - r.left) / r.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((rel - PAD.left) / iw) * (n - 1))));
    setHover({ i, x: x(i) });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover?.i ?? n - 1;
    const i = Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
    setHover({ i, x: x(i) });
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: от ${num(values[0] ?? 0)} до ${num(values.at(-1) ?? 0)} за ${n} дн. Стрелки влево и вправо — значения по дням`}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover({ i: n - 1, x: x(n - 1) })}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={PAD.left - 8} y={y(t)} className="chart__tick" textAnchor="end" dominantBaseline="middle">
              {tick(t)}
            </text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 6} className="chart__tick" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {dayShort(days[i]!)}
          </text>
        ))}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} className="chart__line" />
        {!hover && n > 0 && <circle cx={x(n - 1)} cy={y(values[n - 1]!)} r={4} className="chart__dot" />}
        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + ih} className="chart__cross" />
            <circle cx={hover.x} cy={y(values[hover.i]!)} r={5} className="chart__dot" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(hover.x, 70), width - 70), top: PAD.top }} role="status">
          <b>{num(values[hover.i]!)}</b>
          <span>{dayShort(days[hover.i]!)}</span>
        </div>
      )}
      <DataTable days={days} rows={[{ label, values }]} />
    </div>
  );
}

/**
 * Столбцы по дням. С двумя рядами — расходящиеся: первый вверх от нуля,
 * второй вниз (например, подписались / отписались).
 */
export function ColumnChart({ days, series, height = 200 }: { days: string[]; series: { label: string; values: number[] }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = days.length;
  const up = series[0]!;
  const down = series[1];
  const maxUp = Math.max(1, ...up.values);
  const maxDown = down ? Math.max(0, ...down.values) : 0;
  const ticks = niceTicks(0, maxUp, 3);
  const top = ticks.at(-1)!;
  const bottom = down && maxDown ? niceTicks(0, maxDown, 2).at(-1)! : 0;
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const zero = PAD.top + (ih * top) / (top + bottom);
  const scale = ih / (top + bottom);
  const slot = iw / n;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const r = Math.min(4, bw / 2);
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  // Скруглён только «конец данных», у оси столбец прямой
  const bar = (i: number, v: number, dir: 1 | -1) => {
    const h = v * scale;
    if (h <= 0) return '';
    const x0 = cx(i) - bw / 2;
    const rr = Math.min(r, h);
    if (dir === 1) {
      const yt = zero - h;
      return `M${x0},${zero} V${yt + rr} Q${x0},${yt} ${x0 + rr},${yt} H${x0 + bw - rr} Q${x0 + bw},${yt} ${x0 + bw},${yt + rr} V${zero} Z`;
    }
    const yb = zero + h;
    return `M${x0},${zero} V${yb - rr} Q${x0},${yb} ${x0 + rr},${yb} H${x0 + bw - rr} Q${x0 + bw},${yb} ${x0 + bw},${yb - rr} V${zero} Z`;
  };
  const labelIdx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s, k) => (
            <span key={s.label}>
              <i className={k ? 'chart-key chart-key--2' : 'chart-key'} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((s) => `${s.label}: всего ${num(s.values.reduce((a, b) => a + b, 0))}`).join('; ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={zero - t * scale} y2={zero - t * scale} className="chart__grid" />
            <text x={PAD.left - 8} y={zero - t * scale} className="chart__tick" textAnchor="end" dominantBaseline="middle">
              {tick(t)}
            </text>
          </g>
        ))}
        {bottom > 0 && (
          <text x={PAD.left - 8} y={zero + bottom * scale} className="chart__tick" textAnchor="end" dominantBaseline="middle">
            −{tick(bottom)}
          </text>
        )}
        {labelIdx.map((i) => (
          <text key={i} x={cx(i)} y={height - 6} className="chart__tick" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
            {dayShort(days[i]!)}
          </text>
        ))}
        {days.map((d, i) => (
          <g
            key={d}
            className={cn('chart__col', hover === i && 'chart__col--on')}
            tabIndex={0}
            role="img"
            aria-label={`${dayShort(d)}: ${series.map((s) => `${s.label} ${num(s.values[i] ?? 0)}`).join(', ')}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            {/* Зона наведения шире столбца */}
            <rect x={cx(i) - slot / 2} y={PAD.top} width={slot} height={ih} fill="transparent" />
            <path d={bar(i, up.values[i] ?? 0, 1)} className="chart__bar" />
            {down && <path d={bar(i, down.values[i] ?? 0, -1)} className="chart__bar chart__bar--2" />}
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={zero} y2={zero} className="chart__axis" />
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(cx(hover), 70), width - 70), top: PAD.top }} role="status">
          {series.map((s, k) => (
            <span key={s.label} className="chart-tip__row">
              <i className={k ? 'chart-key chart-key--2' : 'chart-key'} />
              <b>{num(s.values[hover] ?? 0)}</b> {s.label}
            </span>
          ))}
          <span>{dayShort(days[hover]!)}</span>
        </div>
      )}
      <DataTable days={days} rows={series} />
    </div>
  );
}

/** Маленький график тренда для плиток и карточек. */
export function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => (hi === lo ? height / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (height - 6));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="sparkline" aria-hidden>
      <path d={d} className="chart__line chart__line--thin" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3} className="chart__dot chart__dot--small" />
    </svg>
  );
}
