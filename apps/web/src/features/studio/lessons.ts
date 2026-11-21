/** Уроки Академии: от первой строки кода до своего приложения. Проверка — по тексту кода. */
export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  text: string[];
  task: string;
  start: string;
  answer: string;
  checks: { label: string; test: (code: string) => boolean }[];
}

const has = (re: RegExp) => (c: string) => re.test(c);

export const LESSONS: Lesson[] = [
  {
    id: 'hello',
    title: 'Первая команда',
    minutes: 3,
    text: ['Программа — это список команд. Компьютер выполняет их сверху вниз.', 'Команда sunnet.notify("…") показывает уведомление. Текст пишут в кавычках.'],
    task: 'Покажите уведомление с текстом «Привет, мир!».',
    start: '// Напишите команду ниже\n',
    answer: 'sunnet.notify("Привет, мир!")\n',
    checks: [{ label: 'вызвана sunnet.notify', test: has(/sunnet\.notify\s*\(/) }, { label: 'текст «Привет, мир!»', test: has(/["'`]Привет, мир!["'`]/) }],
  },
  {
    id: 'vars',
    title: 'Переменные',
    minutes: 4,
    text: ['Переменная — коробка с именем, куда кладут значение: const name = "Саша".', 'Потом значение можно использовать по имени, например в уведомлении.'],
    task: 'Создайте переменную name со своим именем и покажите уведомление с ней.',
    start: 'const name = ""\n',
    answer: 'const name = "Саша"\nsunnet.notify("Привет, " + name)\n',
    checks: [{ label: 'есть переменная name', test: has(/(const|let)\s+name\s*=/) }, { label: 'name используется в уведомлении', test: has(/sunnet\.notify\([^)]*name/) }],
  },
  {
    id: 'find',
    title: 'Элементы экрана',
    minutes: 4,
    text: ['Всё, что вы рисуете в Студии, — элементы. У каждого есть имя в Explorer.', 'screen.find("Имя") находит элемент, чтобы им управлять из кода.'],
    task: 'Найдите элемент «Заголовок» и поменяйте его текст на «Добро пожаловать».',
    start: '',
    answer: 'screen.find("Заголовок").setText("Добро пожаловать")\n',
    checks: [{ label: 'screen.find("Заголовок")', test: has(/screen\.find\(\s*["'`]Заголовок["'`]\s*\)/) }, { label: 'вызван setText', test: has(/\.setText\s*\(/) }],
  },
  {
    id: 'click',
    title: 'Кнопка, которая отвечает',
    minutes: 5,
    text: ['Кнопки реагируют на нажатие через onClick. Внутрь передают функцию: () => { … }.', 'Код внутри функции выполнится в момент нажатия.'],
    task: 'По нажатию на «Кнопка» покажите уведомление «Нажали!».',
    start: 'const btn = screen.find("Кнопка")\n',
    answer: 'const btn = screen.find("Кнопка")\nbtn.onClick(() => {\n  sunnet.notify("Нажали!")\n})\n',
    checks: [{ label: 'есть onClick', test: has(/\.onClick\s*\(/) }, { label: 'внутри — уведомление', test: has(/onClick\s*\([\s\S]*sunnet\.notify/) }],
  },
  {
    id: 'if',
    title: 'Условия',
    minutes: 5,
    text: ['if проверяет условие: если оно верно — выполняется блок, иначе — else.', 'Сравнивают через === (равно), > и <.'],
    task: 'Если в переменной age число 18 или больше — уведомление «Доступ открыт», иначе «Рано».',
    start: 'const age = 20\n',
    answer: 'const age = 20\nif (age >= 18) {\n  sunnet.notify("Доступ открыт")\n} else {\n  sunnet.notify("Рано")\n}\n',
    checks: [{ label: 'есть if', test: has(/if\s*\(/) }, { label: 'есть else', test: has(/else/) }, { label: 'сравнение с 18', test: has(/age\s*>=\s*18/) }],
  },
  {
    id: 'counter',
    title: 'Счётчик нажатий',
    minutes: 6,
    text: ['let — переменная, которую можно менять. count = count + 1 увеличивает значение.', 'Соединим кнопку, переменную и текст на экране.'],
    task: 'При каждом нажатии на «Кнопка» увеличивайте count и пишите число в «Заголовок».',
    start: 'let count = 0\n',
    answer: 'let count = 0\nscreen.find("Кнопка").onClick(() => {\n  count = count + 1\n  screen.find("Заголовок").setText("Нажатий: " + count)\n})\n',
    checks: [{ label: 'let count', test: has(/let\s+count/) }, { label: 'count увеличивается', test: has(/count\s*(\+\+|\+=\s*1|=\s*count\s*\+\s*1)/) }, { label: 'текст обновляется', test: has(/setText\([^)]*count/) }],
  },
  {
    id: 'anim',
    title: 'Анимации',
    minutes: 4,
    text: ['animate("имя") проигрывает анимацию: pulse, float, spin, fade, pop.', 'Можно задать длительность: animate("spin", { duration: 800 }).'],
    task: 'По нажатию на «Кнопка» закрутите элемент «Солнце».',
    start: '',
    answer: 'screen.find("Кнопка").onClick(() => {\n  screen.find("Солнце").animate("spin", { duration: 800 })\n})\n',
    checks: [{ label: 'onClick у кнопки', test: has(/onClick/) }, { label: 'animate("spin")', test: has(/animate\(\s*["'`]spin["'`]/) }],
  },
  {
    id: 'loop',
    title: 'Повторение',
    minutes: 5,
    text: ['for повторяет блок несколько раз: for (let i = 1; i <= 3; i++) { … }.', 'ui.text(...) добавляет строку на экран прямо из кода.'],
    task: 'Выведите строки «Шаг 1», «Шаг 2», «Шаг 3» с помощью цикла и ui.text.',
    start: '',
    answer: 'for (let i = 1; i <= 3; i++) {\n  ui.text("Шаг " + i)\n}\n',
    checks: [{ label: 'есть цикл for', test: has(/for\s*\(/) }, { label: 'ui.text в цикле', test: has(/for[\s\S]*ui\.text/) }],
  },
  {
    id: 'input',
    title: 'Поле ввода',
    minutes: 5,
    text: ['Элемент «Поле ввода» принимает текст. getText() возвращает то, что ввели.', 'Так делают формы, поиск и чаты.'],
    task: 'По нажатию на «Кнопка» поздоровайтесь с именем из поля «Имя».',
    start: '',
    answer: 'screen.find("Кнопка").onClick(() => {\n  const name = screen.find("Имя").getText()\n  sunnet.notify("Привет, " + name)\n})\n',
    checks: [{ label: 'getText у поля «Имя»', test: has(/find\(\s*["'`]Имя["'`]\s*\)\.getText/) }, { label: 'уведомление с именем', test: has(/notify\([^)]*name/) }],
  },
  {
    id: 'screens',
    title: 'Несколько экранов',
    minutes: 4,
    text: ['Приложение может состоять из нескольких экранов. sunnet.go("Имя экрана") переключает экран.', 'Экраны добавляются кнопкой «+» в Explorer.'],
    task: 'По нажатию на «Кнопка» перейдите на экран «Настройки».',
    start: '',
    answer: 'screen.find("Кнопка").onClick(() => sunnet.go("Настройки"))\n',
    checks: [{ label: 'sunnet.go("Настройки")', test: has(/sunnet\.go\(\s*["'`]Настройки["'`]/) }],
  },
  {
    id: 'perm',
    title: 'Разрешения',
    minutes: 4,
    text: ['Приложения работают в песочнице. Чтобы получить камеру или уведомления, нужно попросить: sunnet.request("camera").', 'Пользователь решает сам и может отозвать разрешение в любой момент. Просите только то, что действительно нужно.'],
    task: 'Попросите разрешение на уведомления.',
    start: '',
    answer: 'sunnet.request("notifications")\n',
    checks: [{ label: 'sunnet.request("notifications")', test: has(/sunnet\.request\(\s*["'`]notifications["'`]/) }],
  },
  {
    id: 'project',
    title: 'Учебный проект: квиз',
    minutes: 10,
    text: ['Соберём всё вместе: вопрос в «Заголовок», две кнопки ответа и счёт.', 'Когда получится — опубликуйте проект и поделитесь ссылкой с друзьями.'],
    task: 'Сделайте так, чтобы «Кнопка» давала +1 к score и показывала «Верно!», а «Кнопка 2» показывала «Мимо».',
    start: 'let score = 0\nscreen.find("Заголовок").setText("2 + 2 = 4?")\n',
    answer:
      'let score = 0\nscreen.find("Заголовок").setText("2 + 2 = 4?")\nscreen.find("Кнопка").onClick(() => {\n  score++\n  sunnet.notify("Верно! Очков: " + score)\n})\nscreen.find("Кнопка 2").onClick(() => sunnet.notify("Мимо"))\n',
    checks: [{ label: 'score увеличивается', test: has(/score\s*(\+\+|\+=\s*1)/) }, { label: '«Верно!»', test: has(/Верно!/) }, { label: '«Кнопка 2» отвечает «Мимо»', test: has(/Кнопка 2[\s\S]*Мимо/) }],
  },
];
