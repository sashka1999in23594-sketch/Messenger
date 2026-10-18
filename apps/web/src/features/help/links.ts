/**
 * Адреса сайта помощи и почта поддержки. Отдельный лёгкий модуль: экран входа
 * может ссылаться на страницы помощи, не подтягивая сам сайт в основной чанк.
 */
import { SUPPORT_EMAIL } from '@omni/shared';

export { SUPPORT_EMAIL };

/** Точка монтирования сайта помощи: <Route path="/help/*" element={<HelpSite />} /> */
export const HELP_BASE = '/help';

export const HELP_PATHS = {
  faq: HELP_BASE,
  partners: `${HELP_BASE}/partners`,
  privacy: `${HELP_BASE}/privacy`,
  terms: `${HELP_BASE}/terms`,
  contacts: `${HELP_BASE}/contacts`,
} as const;

/** Дата вступления в силу Политики конфиденциальности и Условий использования */
export const DOCS_EFFECTIVE = { label: '18 октября 2026 г.', iso: '2026-10-18' } as const;

/** Ссылка mailto: с темой и, при желании, заготовкой письма. */
export function mailto(subject: string, body?: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join('&')}`;
}
