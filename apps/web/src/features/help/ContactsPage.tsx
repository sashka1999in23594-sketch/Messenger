import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, Mail, ShieldAlert } from 'lucide-react';
import { HELP_PATHS, SUPPORT_EMAIL, mailto } from './links';
import { PageHead, useDocumentTitle } from './ui';

const SUBJECT = 'Вопрос в поддержку Sunnet';

/** Заготовка письма: те же пункты, что и в списке «Что указать в письме». */
const LETTER = `Здравствуйте!

Что случилось:


Имя пользователя (@…):
Устройство и система (например, iPhone 15, iOS 18):
Браузер или приложение (например, Chrome, Safari, приложение для Windows):
Когда это произошло (дата, время, часовой пояс):

Скриншот или запись экрана — во вложении.
`;

const TOPICS = [
  { label: 'Не могу войти', subject: 'Не могу войти в аккаунт' },
  { label: 'Не работает звонок', subject: 'Проблема со звонком' },
  { label: 'Ошибка или сбой', subject: 'Ошибка в Sunnet' },
  { label: 'Жалоба', subject: 'Жалоба на пользователя или контент' },
  { label: 'Данные и конфиденциальность', subject: 'Персональные данные' },
];

export function ContactsPage() {
  useDocumentTitle('Связаться с нами — Sunnet');
  return (
    <>
      <PageHead
        eyebrow="Поддержка"
        title="Связаться с нами"
        lead={
          <>
            Напишите на почту — ответит человек из команды Sunnet. Возможно, ответ уже есть в{' '}
            <Link to={HELP_PATHS.faq}>вопросах и ответах</Link>.
          </>
        }
      />

      <section className="help-mailcard" aria-labelledby="contacts-mail">
        <h2 id="contacts-mail" className="help-mailcard__label">
          Почта поддержки
        </h2>
        <a className="help-mailcard__addr" href={mailto(SUBJECT, LETTER)}>
          {SUPPORT_EMAIL}
        </a>
        <div className="help-actions">
          <a className="help-btn help-btn--primary" href={mailto(SUBJECT, LETTER)}>
            <Mail size={18} aria-hidden /> Написать письмо
          </a>
          <CopyEmail />
        </div>
        <p className="help-mailcard__hint">
          Откроется ваша почтовая программа с готовой темой и заготовкой письма. Если ничего не
          открылось, скопируйте адрес и напишите с любой почты.
        </p>
      </section>

      <section className="help-section" aria-labelledby="contacts-topics">
        <h2 id="contacts-topics">Выберите тему</h2>
        <p className="help-section__lead">
          Тема в письме помогает быстрее передать вопрос нужному человеку.
        </p>
        <ul className="help-chips help-chips--topics">
          {TOPICS.map((t) => (
            <li key={t.subject}>
              <a className="help-chip" href={mailto(t.subject, LETTER)}>
                {t.label}
              </a>
            </li>
          ))}
          <li>
            <Link className="help-chip" to={HELP_PATHS.partners}>
              Сотрудничество
            </Link>
          </li>
        </ul>
      </section>

      <section className="help-section" aria-labelledby="contacts-what">
        <h2 id="contacts-what">Что указать в письме</h2>
        <div className="help-prose">
          <p>Чем подробнее письмо, тем быстрее мы разберёмся — без лишних уточнений:</p>
          <ul className="help-checklist">
            <li>
              <strong>имя пользователя</strong> (@username) — или почту, к которой привязан аккаунт;
            </li>
            <li>
              <strong>устройство</strong> — например, iPhone 15, Samsung Galaxy A54, ноутбук;
            </li>
            <li>
              <strong>операционную систему</strong> и её версию — iOS, Android, Windows, macOS,
              Linux;
            </li>
            <li>
              <strong>браузер</strong> и его версию — или что вы пользуетесь приложением для
              компьютера;
            </li>
            <li>
              <strong>что произошло</strong> и какие шаги к этому привели, текст ошибки, если он
              был;
            </li>
            <li>
              <strong>скриншот</strong> или короткую запись экрана;
            </li>
            <li>
              <strong>время</strong>, когда это случилось, — дату, время и часовой пояс;
            </li>
            <li>
              для звонков — <strong>тип сети</strong>: домашний Wi-Fi, мобильный интернет,
              корпоративная сеть, VPN.
            </li>
          </ul>
        </div>
      </section>

      <aside className="help-note help-note--warn help-warn" aria-labelledby="contacts-never">
        <ShieldAlert className="help-warn__icon" size={22} aria-hidden />
        <div>
          <h2 id="contacts-never">Никогда не присылайте пароли и коды</h2>
          <p>
            Нам не нужны ваш пароль, коды из писем и чата «Sunnet» или подтверждение входа по
            QR-коду — сотрудники Sunnet никогда их не спрашивают. Если кто-то просит их от нашего
            имени, это мошенник. Перед отправкой скриншота проверьте, что на нём не видно кодов.
          </p>
        </div>
      </aside>

      <section className="help-section" aria-labelledby="contacts-when">
        <h2 id="contacts-when">Когда ждать ответа</h2>
        <div className="help-prose">
          <p>
            Обычно мы отвечаем в течение <strong>1–2 рабочих дней</strong>. Сложные случаи могут
            занять больше времени, но без ответа мы не оставим ни одно письмо.
          </p>
          <p>
            Ответ придёт на адрес, с которого вы писали, — загляните и в «Спам». Чтобы дополнить
            вопрос, отвечайте в той же переписке: так вся история будет перед глазами.
          </p>
        </div>
      </section>

      <section className="help-section" aria-labelledby="contacts-hacked">
        <h2 id="contacts-hacked">Если аккаунт взломали</h2>
        <div className="help-prose">
          <ol>
            <li>
              Восстановите пароль через «Забыли пароль?» на экране входа — после этого все остальные
              сеансы завершатся.
            </li>
            <li>
              Проверьте «Настройки → Безопасность → Устройства и сеансы» и журнал безопасности.
            </li>
            <li>
              Напишите нам с темой <a href={mailto('Взлом аккаунта', LETTER)}>«Взлом аккаунта»</a> и
              укажите имя пользователя — поможем вернуть доступ.
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}

/** Копирует адрес поддержки в буфер обмена. */
function CopyEmail() {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      setFailed(true);
    }
  };
  if (failed) return null;
  return (
    <button type="button" className="help-btn" onClick={() => void copy()}>
      {done ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
      <span aria-live="polite">{done ? 'Адрес скопирован' : 'Скопировать адрес'}</span>
    </button>
  );
}
