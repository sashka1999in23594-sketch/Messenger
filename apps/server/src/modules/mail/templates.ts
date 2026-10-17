/**
 * Шаблоны писем: HTML (табличная вёрстка и встроенные стили — так письма
 * одинаково выглядят в Gmail, Почте Mail.ru, Яндексе и Outlook) + текстовая версия.
 * Все подставляемые значения экранируются.
 */
import { APP_NAME } from '@omni/shared';
import type { Mail } from './mail.service.js';

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface LayoutInput {
  to: string;
  tag: string;
  subject: string;
  /** Первая строка, которую почтовики показывают в списке писем */
  preheader: string;
  title: string;
  /** Абзацы текста (обычный текст, экранируется) */
  lines: string[];
  code?: string;
  button?: { label: string; url: string };
  /** Таблица деталей: устройство, IP, время */
  details?: [string, string][];
  footnote?: string;
}

function render(i: LayoutInput): Mail {
  const paragraphs = i.lines.map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3b3f55">${esc(l)}</p>`).join('');
  const code = i.code
    ? `<div style="margin:22px 0;padding:18px 0;border-radius:16px;background:#f3f1ff;text-align:center;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#2a1f7a">${esc(i.code)}</div>`
    : '';
  const button = i.button
    ? `<div style="margin:24px 0"><a href="${esc(i.button.url)}" style="display:inline-block;padding:13px 26px;border-radius:14px;background:#7c5cff;background-image:linear-gradient(135deg,#7c5cff,#00b8ff);color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${esc(i.button.label)}</a></div>`
    : '';
  const details = i.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 18px;border-collapse:collapse">${i.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #eceaf6;font-size:13px;color:#8a8ea6;width:38%">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eceaf6;font-size:14px;color:#1d2036;font-weight:600">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const footnote = i.footnote ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#8a8ea6">${esc(i.footnote)}</p>` : '';

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(i.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef0f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(i.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f8;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px -30px rgba(40,40,120,.45);font-family:-apple-system,'Segoe UI',Roboto,Inter,Arial,sans-serif">
<tr><td style="padding:26px 32px;background:#6d4aff;background-image:linear-gradient(135deg,#6d4aff 0%,#7c5cff 45%,#00b8ff 100%)">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px;height:40px;border-radius:13px;background:rgba(255,255,255,.22);text-align:center;vertical-align:middle;font-size:22px;font-weight:800;color:#fff">◎</td>
<td style="padding-left:12px;font-size:22px;font-weight:800;letter-spacing:-.5px;color:#ffffff">${APP_NAME}</td>
</tr></table>
</td></tr>
<tr><td style="padding:30px 32px 32px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;letter-spacing:-.3px;color:#11142a">${esc(i.title)}</h1>
${paragraphs}${code}${button}${details}${footnote}
</td></tr>
<tr><td style="padding:18px 32px;background:#f7f7fc;font-size:12px;line-height:1.5;color:#9a9db3">
Это автоматическое письмо от ${APP_NAME}, отвечать на него не нужно. Сотрудники ${APP_NAME} никогда не спрашивают пароль и коды из писем.
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    i.title,
    '',
    ...i.lines,
    ...(i.code ? ['', `Код: ${i.code}`] : []),
    ...(i.button ? ['', `${i.button.label}: ${i.button.url}`] : []),
    ...(i.details ? ['', ...i.details.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(i.footnote ? ['', i.footnote] : []),
    '',
    `— ${APP_NAME}. Сотрудники ${APP_NAME} никогда не спрашивают пароль и коды из писем.`,
  ].join('\n');

  return { to: i.to, subject: i.subject, text, html, tag: i.tag };
}

export interface DeviceInfo {
  device: string;
  ip: string;
  time: Date;
}

const fmtTime = (d: Date) =>
  d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' (МСК)';

const deviceRows = (d: DeviceInfo): [string, string][] => [
  ['Устройство', d.device],
  ['IP-адрес', d.ip],
  ['Время', fmtTime(d.time)],
];

export const templates = {
  verifyEmail: (to: string, name: string, code: string): Mail =>
    render({
      to,
      tag: 'verify_email',
      subject: `${code} — код подтверждения почты ${APP_NAME}`,
      preheader: `Ваш код: ${code}. Он действует 15 минут.`,
      title: 'Подтвердите почту',
      lines: [`${name}, добро пожаловать в ${APP_NAME}! Введите этот код в приложении, чтобы подтвердить адрес почты.`],
      code,
      footnote: 'Код действует 15 минут. Если вы не регистрировались в Omni, просто проигнорируйте это письмо.',
    }),

  welcome: (to: string, name: string, origin: string): Mail =>
    render({
      to,
      tag: 'welcome',
      subject: `Почта подтверждена — добро пожаловать в ${APP_NAME}!`,
      preheader: 'Чаты, лента, видео, клипы и истории — в одном приложении.',
      title: `${name}, всё готово! 🎉`,
      lines: [
        'Почта подтверждена. Теперь на неё можно восстановить доступ к аккаунту, получать коды входа и уведомления о безопасности.',
        'Совет: включите двухфакторную защиту в настройках безопасности — так аккаунт будет защищён даже при утечке пароля.',
      ],
      button: { label: `Открыть ${APP_NAME}`, url: origin },
    }),

  loginCode: (to: string, name: string, code: string, d: DeviceInfo): Mail =>
    render({
      to,
      tag: 'login_code',
      subject: `${code} — код для входа в ${APP_NAME}`,
      preheader: `Код для входа: ${code}. Никому его не сообщайте.`,
      title: 'Код для входа',
      lines: [`${name}, кто-то (надеемся, вы) входит в ваш аккаунт. Введите этот код, чтобы завершить вход.`],
      code,
      details: deviceRows(d),
      footnote: 'Код действует 10 минут. Если это были не вы — ваш пароль известен кому-то ещё: смените его в настройках безопасности.',
    }),

  confirmAction: (to: string, name: string, code: string, action: string): Mail =>
    render({
      to,
      tag: 'confirm_action',
      subject: `${code} — подтверждение действия в ${APP_NAME}`,
      preheader: `Код подтверждения: ${code}`,
      title: 'Подтвердите действие',
      lines: [`${name}, вы запросили: «${action}». Введите код, чтобы подтвердить.`],
      code,
      footnote: 'Код действует 15 минут. Если вы ничего не запрашивали — смените пароль.',
    }),

  resetPassword: (to: string, name: string, code: string, d: DeviceInfo): Mail =>
    render({
      to,
      tag: 'reset_password',
      subject: `${code} — восстановление доступа к ${APP_NAME}`,
      preheader: `Код для сброса пароля: ${code}`,
      title: 'Сброс пароля',
      lines: [`${name}, мы получили запрос на сброс пароля. Введите этот код на экране восстановления и придумайте новый пароль.`],
      code,
      details: deviceRows(d),
      footnote: 'Код действует 30 минут. Если вы не запрашивали сброс — просто проигнорируйте письмо, пароль останется прежним.',
    }),

  newLogin: (to: string, name: string, d: DeviceInfo, origin: string): Mail =>
    render({
      to,
      tag: 'new_login',
      subject: `Новый вход в ${APP_NAME}: ${d.device}`,
      preheader: `Вход с нового устройства: ${d.device}`,
      title: 'Вход с нового устройства',
      lines: [`${name}, в ваш аккаунт только что вошли с устройства, которое мы раньше не видели.`],
      details: deviceRows(d),
      button: { label: 'Проверить устройства', url: `${origin}/settings/security/sessions` },
      footnote: 'Если это были вы — ничего делать не нужно. Если нет — завершите сеанс и смените пароль.',
    }),

  securityChange: (to: string, name: string, what: string, d: DeviceInfo, origin: string): Mail =>
    render({
      to,
      tag: 'security_change',
      subject: `${what} — ${APP_NAME}`,
      preheader: `${what}. Если это были не вы — срочно проверьте аккаунт.`,
      title: what,
      lines: [`${name}, в настройках безопасности вашего аккаунта произошло изменение: ${what.toLowerCase()}.`],
      details: deviceRows(d),
      button: { label: 'Открыть настройки безопасности', url: `${origin}/settings/security` },
      footnote: 'Если это были не вы — немедленно смените пароль и завершите все остальные сеансы.',
    }),
};
