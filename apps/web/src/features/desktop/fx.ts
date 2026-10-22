/**
 * Анимации окон без лишних перерисовок React: элементы окон и значков дока
 * регистрируются здесь, а появление, сворачивание в док и закрытие
 * проигрываются через Web Animations прямо на DOM-узлах.
 */
import { appFor } from './apps';
import { activeWin, useDesktop } from './store';

export const winEls = new Map<string, HTMLElement>();
/** Значки дока: приложения по id, свёрнутые окна — `win:<id>`, конец ряда свёрнутых — `min-end` */
export const dockEls = new Map<string, HTMLElement>();

const busy = new Set<string>();
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 0.8, 0.4)';

export function motionOn(): boolean {
  return document.documentElement.dataset.reduceMotion !== 'true' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Сдвиг и масштаб, переводящие прямоугольник окна в значок дока. */
function toward(el: HTMLElement, target: DOMRect | null | undefined): string {
  if (!target) return 'translateY(48px) scale(0.6)';
  const r = el.getBoundingClientRect();
  const dx = target.left + target.width / 2 - (r.left + r.width / 2);
  const dy = target.top + target.height / 2 - (r.top + r.height / 2);
  const s = Math.max(0.04, Math.min(target.width / r.width, target.height / r.height));
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

function dockTargetFor(id: string): DOMRect | null {
  const w = useDesktop.getState().wins.find((x) => x.id === id);
  const el = dockEls.get(`win:${id}`) ?? dockEls.get('min-end') ?? (w ? dockEls.get(appFor(w.path).id) : undefined);
  return el?.getBoundingClientRect() ?? null;
}

/** Появление нового окна: из значка дока или лёгкое увеличение на месте. */
export function playOpen(el: HTMLElement, origin: DOMRect | null) {
  if (!motionOn()) return;
  if (origin) {
    el.animate([{ transform: toward(el, origin), opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: EASE_OUT });
  } else {
    el.animate([{ transform: 'scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE_OUT });
  }
}

/** Возврат свёрнутого окна из дока. */
export function playRestore(el: HTMLElement, from: DOMRect | null) {
  if (!motionOn()) return;
  el.animate([{ transform: toward(el, from), opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: EASE_OUT });
}

/** Значок дока для анимации возврата окна (сохраняется до того, как окно появится). */
export function restoreOrigin(id: string): DOMRect | null {
  return dockTargetFor(id);
}

export async function minimizeWindow(id: string) {
  if (busy.has(id)) return;
  const el = winEls.get(id);
  if (el && motionOn()) {
    busy.add(id);
    el.classList.add('desk-win--leaving');
    try {
      await el.animate([{ transform: 'none', opacity: 1 }, { transform: toward(el, dockTargetFor(id)), opacity: 0 }], { duration: 300, easing: EASE_IN, fill: 'forwards' }).finished;
    } catch {
      // анимацию прервали — просто сворачиваем
    }
    el.classList.remove('desk-win--leaving');
    el.getAnimations().forEach((a) => a.cancel());
    busy.delete(id);
  }
  useDesktop.getState().minimize(id);
}

export async function closeWindow(id: string) {
  if (busy.has(id)) return;
  const el = winEls.get(id);
  if (el && motionOn()) {
    busy.add(id);
    el.classList.add('desk-win--leaving');
    try {
      await el.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(0.94)', opacity: 0 }], { duration: 170, easing: EASE_IN, fill: 'forwards' }).finished;
    } catch {
      // ничего страшного
    }
    busy.delete(id);
  }
  useDesktop.getState().close(id);
}

export function closeWindows(ids: string[]) {
  ids.forEach((id) => void closeWindow(id));
}

/** Плавная перестановка: на время смены размеров у окон включаются переходы. */
export function withGlide(fn: () => void) {
  if (!motionOn()) return fn();
  const els = [...winEls.values()];
  els.forEach((el) => el.classList.add('desk-win--glide'));
  fn();
  window.setTimeout(() => els.forEach((el) => el.classList.remove('desk-win--glide')), 320);
}

/** Сделать окно активным и перевести в него фокус клавиатуры. */
export function activate(id: string) {
  useDesktop.getState().focus(id);
  requestAnimationFrame(() => {
    const el = winEls.get(id);
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  });
}

/** Открыть раздел из дока, меню или поиска: окно «вылетает» из значка. */
export function openPath(path: string, opts: { newWindow?: boolean; from?: Element | null } = {}) {
  const id = useDesktop.getState().open(path, { newWindow: opts.newWindow, origin: opts.from?.getBoundingClientRect() ?? null });
  activate(id);
  return id;
}

export const activeId = () => activeWin(useDesktop.getState().wins)?.id;

/** Прыжок значка в доке при запуске — как в macOS. */
export function bounce(el: Element | null | undefined) {
  if (!el || !motionOn()) return;
  (el as HTMLElement).animate(
    [{ translate: '0 0' }, { translate: '0 -14px', offset: 0.3 }, { translate: '0 0', offset: 0.6 }, { translate: '0 -5px', offset: 0.8 }, { translate: '0 0' }],
    { duration: 620, easing: 'ease-out' },
  );
}
