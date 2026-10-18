/**
 * SpaceUp: письма с кодами через ваш Gmail.
 * script.google.com → Новый проект → вставьте этот код целиком → придумайте SECRET
 * (тот же впишите в MAIL_SCRIPT_SECRET) → Развернуть → Новое развёртывание →
 * Веб-приложение: «Запуск от имени: я», «Доступ: все» → скопируйте адрес …/exec
 * в MAIL_SCRIPT_URL. Бесплатно — до 100 писем в день, письма уходят от вашего адреса.
 */
const SECRET = 'ВСТАВЬТЕ_СЮДА_СЕКРЕТ';

function doPost(e) {
  const reply = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad_request' });
  }
  if (!req || req.secret !== SECRET) return reply({ ok: false, error: 'secret' });
  if (req.ping) return reply({ ok: true, quota: MailApp.getRemainingDailyQuota() });
  MailApp.sendEmail({ to: req.to, subject: req.subject, body: req.text, htmlBody: req.html, name: req.name || 'SpaceUp' });
  return reply({ ok: true });
}
