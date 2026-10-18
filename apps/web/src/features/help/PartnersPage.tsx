import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Building2, Clapperboard, Handshake, Mail, Megaphone, Newspaper } from 'lucide-react';
import { HELP_PATHS, SUPPORT_EMAIL, mailto } from './links';
import { PageHead, useDocumentTitle } from './ui';

const SUBJECT = 'Сотрудничество';

const LETTER = `Здравствуйте!

Кто я и что представляю (имя, компания или проект, ссылка):

Суть предложения:

Что предлагаем мы и чего ждём от SpaceUp:

Сроки и бюджет (если есть):

Как со мной удобнее связаться:
`;

const DIRECTIONS: Array<{ title: string; icon: ReactNode; text: ReactNode }> = [
  {
    title: 'Партнёрства',
    icon: <Handshake size={22} aria-hidden />,
    text: (
      <>
        Сервисы, образовательные проекты, мероприятия и некоммерческие организации, которым по пути
        с SpaceUp. Совместные проекты, интеграции с вашим сервисом, спецпроекты для аудитории —
        расскажите, что вы делаете и чем это будет полезно людям.
      </>
    ),
  },
  {
    title: 'Реклама и интеграции',
    icon: <Megaphone size={22} aria-hidden />,
    text: (
      <>
        Мы не подключаем сторонние рекламные сети и не продаём данные пользователей, поэтому
        таргетинга по личным данным у нас нет. Обсуждаем честные форматы: спецпроекты и интеграции с
        явной пометкой «реклама», которые не мешают общению. Разместить рекламу у конкретного автора
        можно, договорившись с ним напрямую.
      </>
    ),
  },
  {
    title: 'Пресса',
    icon: <Newspaper size={22} aria-hidden />,
    text: (
      <>
        Журналистам и редакциям: комментарии, интервью, факты о SpaceUp и скриншоты интерфейса для
        материалов. Укажите издание, тему и дедлайн — постараемся успеть.
      </>
    ),
  },
  {
    title: 'Блогеры и авторы',
    icon: <Clapperboard size={22} aria-hidden />,
    text: (
      <>
        Ведёте канал, снимаете кометы и видео, выходите в эфир? В SpaceUp для этого есть каналы,
        кометы, видео, прямые эфиры до 50 зрителей, премьеры с общим чатом и статистика. Напишите,
        если хотите запустить совместный проект или рассказать, каких инструментов вам не хватает.
      </>
    ),
  },
  {
    title: 'Компании и сообщества',
    icon: <Building2 size={22} aria-hidden />,
    text: (
      <>
        «Компании» — закрытые пространства для команд, раздел пока работает по приглашению.
        «Сообщества» — пространства по интересам. Хотите перевести в SpaceUp команду, клуб или
        сообщество — расскажите о себе, поможем всё настроить.
      </>
    ),
  },
];

export function PartnersPage() {
  useDocumentTitle('Сотрудничество — SpaceUp');
  return (
    <>
      <PageHead
        eyebrow="Сотрудничество"
        title="Давайте делать SpaceUp вместе"
        lead={
          <>
            SpaceUp — молодой мессенджер и социальная платформа, который растёт вместе с людьми,
            которые им пользуются. Если у вас есть идея, проект или предложение — мы с радостью его
            обсудим.
          </>
        }
      >
        <div className="help-actions help-head__actions">
          <a className="help-btn help-btn--primary" href={mailto(SUBJECT, LETTER)}>
            <Mail size={18} aria-hidden /> Написать о сотрудничестве
          </a>
        </div>
      </PageHead>

      <ul className="help-cards" aria-label="Направления">
        {DIRECTIONS.map((d) => (
          <li key={d.title} className="help-card">
            <span className="help-card__icon">{d.icon}</span>
            <h2>{d.title}</h2>
            <p>{d.text}</p>
          </li>
        ))}
        <li className="help-card help-card--plain">
          <h2>Не нашли своё направление?</h2>
          <p>
            Всё равно напишите. Хорошие идеи не всегда помещаются в рубрики — мы читаем каждое
            письмо.
          </p>
          <p>
            <a href={mailto(SUBJECT, LETTER)}>Написать нам</a>
          </p>
        </li>
      </ul>

      <section className="help-section" aria-labelledby="partners-how">
        <h2 id="partners-how">Как написать нам</h2>
        <div className="help-prose">
          <p>
            Отправьте письмо на <a href={mailto(SUBJECT, LETTER)}>{SUPPORT_EMAIL}</a> с темой{' '}
            <strong>«{SUBJECT}»</strong> — так оно сразу попадёт к нужному человеку. Чтобы мы
            ответили по делу с первого раза, укажите:
          </p>
          <ul className="help-checklist">
            <li>кто вы: имя, компания или проект, ссылка на сайт или соцсети;</li>
            <li>суть предложения — в двух-трёх предложениях;</li>
            <li>что вы предлагаете и чего ждёте от SpaceUp;</li>
            <li>сроки и бюджет, если они уже есть;</li>
            <li>для прессы — издание, тему и дедлайн;</li>
            <li>для авторов — ссылки на ваши каналы и примерный размер аудитории;</li>
            <li>как с вами удобнее связаться.</li>
          </ul>
          <p>
            Презентацию или медиакит можно приложить к письму файлом PDF. Пожалуйста, не присылайте
            пароли, коды и чужие персональные данные.
          </p>
        </div>
      </section>

      <section className="help-section" aria-labelledby="partners-time">
        <h2 id="partners-time">Когда ждать ответа</h2>
        <div className="help-prose">
          <p>
            Мы отвечаем на письма о сотрудничестве в течение <strong>3–5 рабочих дней</strong>. Если
            вопрос срочный — например, у материала дедлайн, — добавьте в тему слово «Срочно» и дату,
            к которой нужен ответ.
          </p>
          <p>
            Вопросы о работе аккаунта лучше задавать в{' '}
            <Link to={HELP_PATHS.contacts}>поддержку</Link> — там ответ придёт быстрее.
          </p>
        </div>
      </section>

      <section className="help-section" aria-labelledby="partners-rules">
        <h2 id="partners-rules">Наши принципы</h2>
        <div className="help-prose">
          <ul>
            <li>Мы не продаём и не передаём данные пользователей партнёрам и рекламодателям.</li>
            <li>Не подключаем сторонние рекламные сети и трекеры.</li>
            <li>Не размещаем скрытую рекламу: всё рекламное помечено.</li>
            <li>
              Партнёрские проекты подчиняются тем же{' '}
              <Link to={HELP_PATHS.terms}>Условиям использования</Link> и{' '}
              <Link to={HELP_PATHS.privacy}>Политике конфиденциальности</Link>, что и весь SpaceUp.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
