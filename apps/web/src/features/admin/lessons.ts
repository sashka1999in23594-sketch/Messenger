/** Учебник языка консоли «Луч»: 9 коротких уроков с примерами, которые можно выполнить. */
export interface Lesson {
  id: string;
  title: string;
  text: string[];
  examples: { code: string; note: string }[];
}

export const LESSONS: Lesson[] = [
  {
    id: 'first',
    title: 'Первая команда',
    text: [
      'Команда — это «раздел.действие(…)». Раздел — то, с чем работаем: user, post, channel, server, payment. Действие — что делаем: count, recent, find, block.',
      'Косая черта в начале не обязательна: /user.online() и user.online() — одно и то же. Скобки у команд без аргументов тоже можно не писать.',
    ],
    examples: [
      { code: 'user.online()', note: 'Кто сейчас в сети' },
      { code: 'help.count()', note: 'Сколько всего команд' },
    ],
  },
  {
    id: 'args',
    title: 'Аргументы и сроки',
    text: [
      'Текст пишется в кавычках: "sashka". Числа — без кавычек. Сроки — тоже без кавычек: 30m (минуты), 12h (часы), 7d (дни), 2w (недели).',
      'Именованные аргументы пишутся через двоеточие: duration: 7d, reason: "спам". Их порядок не важен.',
    ],
    examples: [
      { code: 'user.info("sashka")', note: 'Всё о пользователе' },
      { code: 'post.recent(5)', note: 'Пять последних публичных постов' },
      { code: '# user.block("ник", duration: 7d, reason: "спам")', note: 'Так блокируют (строка с # — комментарий, не выполняется)' },
    ],
  },
  {
    id: 'verbs',
    title: 'Одинаковые глаголы везде',
    text: [
      'У каждого раздела одни и те же действия — выучил один, знаешь все: count, today, week, month, year, hour, yesterday, compare, growth, weekdays, hours, months, recent, oldest, first, last, random, find, search, of, by, leaders, top, export, fields.',
      'Разделы: user, post, video, reel, comment, story, channel, group, community, company, server, app, payment, report, file, stream, playlist, call, session, notification, cloud, subscription, bridge, follow, like, bookmark, hashtag, poll, invite, draft, security, view, message.',
    ],
    examples: [
      { code: 'user.growth(14)', note: 'Регистрации за две недели — с графиком' },
      { code: 'post.compare()', note: 'Эта неделя против прошлой' },
      { code: 'channel.top("member_count", 5)', note: 'Крупнейшие каналы' },
    ],
  },
  {
    id: 'vars',
    title: 'Переменные',
    text: [
      'let имя = значение — запомнить результат. Потом его можно подставлять в команды и в текст: "Привет, {имя}".',
      'Русские слова тоже работают: пусть, вывод, если, иначе, для, в, повтор.',
    ],
    examples: [
      { code: 'let n = user.count()\necho "Нас уже {n}!"', note: 'Число из команды — в текст' },
      { code: 'пусть цель = 1000\nпусть сейчас = user.count()\nвывод цель - сейчас', note: 'Сколько осталось до цели' },
    ],
  },
  {
    id: 'pipes',
    title: 'Конвейер |',
    text: [
      'Знак | передаёт результат дальше, как по конвейеру. where — отобрать, sort — упорядочить (desc — по убыванию), take — первые N, pick — оставить поля, count — посчитать.',
      'Ещё есть: skip, first, last, sum, avg, unique, group, reverse, map.',
    ],
    examples: [
      { code: 'user.recent(100) | where verified == 1 | pick username', note: 'Ники с галочкой среди новых' },
      { code: 'post.recent(50) | sort like_count desc | take 3 | pick text', note: 'Три самых любимых из свежих' },
      { code: 'user.recent(200) | group role', note: 'Сколько пользователей в каждой роли' },
    ],
  },
  {
    id: 'if',
    title: 'Условия',
    text: ['if условие { … } else { … }. Сравнения: ==, !=, >, <, >=, <=, contains (содержит). Связки: and, or, not.'],
    examples: [
      { code: 'if report.count() > 0 { report.list(5) } else { echo "Жалоб нет 🎉" }', note: 'Показать жалобы, только если они есть' },
      { code: 'если user.today() >= 10 { вывод "Отличный день" } иначе { вывод "Спокойный день" }', note: 'То же по-русски' },
    ],
  },
  {
    id: 'loops',
    title: 'Циклы',
    text: [
      'for x in список { … } — сделать для каждого. repeat N { … } — повторить N раз, номер шага — в переменной i.',
      'В команды можно передавать целую запись: user.unblock(u) — Луч сам возьмёт ник.',
    ],
    examples: [
      { code: 'for u in user.recent(3) { echo "Новенький: {u.username}" }', note: 'Пройтись по списку' },
      { code: 'repeat 3 { echo "Шаг {i}" }', note: 'Повторить три раза' },
      { code: '# for u in user.blocked() { user.unblock(u) }', note: 'Разблокировать всех разом (снимите # чтобы выполнить)' },
    ],
  },
  {
    id: 'mod',
    title: 'Модерация',
    text: [
      'Главные команды: user.block / unblock / warn / logout, post.delete / restore / lock, comment.delete, report.list / resolve / reject, badge.give / take, role.grant.',
      'Каждое действие пишется в журнал — посмотреть: audit.show(20) или audit.user("ник"). Личные переписки закрыты для всех, включая владельца: по сообщениям доступны только числа.',
    ],
    examples: [
      { code: 'report.stats()', note: 'Жалобы по статусам' },
      { code: 'audit.show(10)', note: 'Последние действия в консоли' },
    ],
  },
  {
    id: 'recipes',
    title: 'Рецепты',
    text: ['Готовые скрипты, которые полезно запускать каждый день. Скопируйте, поменяйте под себя.'],
    examples: [
      {
        code: 'echo "Утренняя сводка"\necho "Новых людей: {user.today}"\necho "Постов за сутки: {post.today}"\nif report.count() > 0 { echo "Есть жалобы — report.list()" }\nuser.growth(7)',
        note: 'Утренняя сводка',
      },
      { code: 'payment.today()\npayment.sum_amount_kop()\npayment.by_status()', note: 'Деньги в приложениях Студии' },
      { code: 'server.recent(20) | where heartbeat_at == null | pick name', note: 'Серверы, которые ни разу не выходили на связь' },
    ],
  },
];
