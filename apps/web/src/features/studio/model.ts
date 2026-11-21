/**
 * Модель проекта Студии и API языка SunScript (обычный JavaScript + объекты
 * `screen`, `ui`, `sunnet`). Описание API — один источник для подсказок
 * в редакторе, проверки ошибок и документации.
 */
import { parse } from 'acorn';

/** Сообщения разборщика — по-русски, чтобы новичку было понятно. */
function translate(msg: string): string {
  const m = msg.replace(/\s*\(\d+:\d+\)$/, '');
  if (/Unexpected token/.test(m)) return 'неожиданный символ';
  if (/Unterminated string/.test(m)) return 'не закрыта кавычка';
  if (/Unexpected character/.test(m)) return 'непонятный символ';
  if (/Unterminated template/.test(m)) return 'не закрыта обратная кавычка `';
  return m;
}

export type ElType = 'text' | 'image' | 'button' | 'box' | 'input';
export type Anim = 'none' | 'pulse' | 'float' | 'spin' | 'fade' | 'pop';

export interface El {
  id: string;
  type: ElType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  src?: string;
  color?: string;
  bg?: string;
  radius?: number;
  fontSize?: number;
  weight?: number;
  anim?: Anim;
}
export interface Screen {
  id: string;
  name: string;
  bg?: string;
  elements: El[];
}
export interface Script {
  id: string;
  name: string;
  code: string;
}
export interface Project {
  screens: Screen[];
  scripts: Script[];
  css?: string;
  width?: number;
  height?: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function emptyProject(): Project {
  return {
    width: 380,
    height: 620,
    screens: [
      {
        id: uid(),
        name: 'Главная',
        bg: 'linear-gradient(180deg, #4b8feb, #bfe0ff)',
        elements: [
          { id: uid(), type: 'text', name: 'Заголовок', x: 30, y: 60, w: 320, h: 60, text: 'Моё приложение', color: '#ffffff', fontSize: 28, weight: 800 },
          { id: uid(), type: 'box', name: 'Солнце', x: 140, y: 170, w: 100, h: 100, bg: 'radial-gradient(circle, #fffbe8, #ffc24a 60%, #ff9d2e)', radius: 50, anim: 'pulse' },
          { id: uid(), type: 'button', name: 'Кнопка', x: 90, y: 330, w: 200, h: 52, text: 'Нажми меня', radius: 26, fontSize: 17, weight: 700 },
        ],
      },
    ],
    scripts: [
      {
        id: uid(),
        name: 'main',
        code: '// Код запускается, когда приложение открылось\nconst btn = screen.find("Кнопка")\n\nbtn.onClick(() => {\n  screen.find("Солнце").animate("spin")\n  sunnet.notify("Привет из моего приложения!")\n})\n',
      },
    ],
  };
}

export const NEW_EL: Record<ElType, Omit<El, 'id' | 'name' | 'x' | 'y'>> = {
  text: { type: 'text', w: 220, h: 40, text: 'Новый текст', color: '#0d1a2d', fontSize: 18, weight: 600 },
  image: { type: 'image', w: 160, h: 120, src: '', radius: 16 },
  button: { type: 'button', w: 180, h: 48, text: 'Кнопка', radius: 24, fontSize: 16, weight: 700 },
  box: { type: 'box', w: 120, h: 120, bg: '#ffffff', radius: 20 },
  input: { type: 'input', w: 240, h: 44, text: 'Введите текст', radius: 12, fontSize: 15 },
};

export const TYPE_LABEL: Record<ElType, string> = { text: 'Текст', image: 'Image', button: 'Кнопка', box: 'Блок', input: 'Поле ввода' };

export interface ApiDoc {
  name: string;
  sig: string;
  text: string;
  example: string;
}

/** API Sunnet для приложений. */
export const API: ApiDoc[] = [
  { name: 'screen.find', sig: 'screen.find(имя)', text: 'Находит элемент экрана по имени из Explorer.', example: 'const b = screen.find("Кнопка")' },
  { name: 'onClick', sig: 'элемент.onClick(функция)', text: 'Выполняет функцию при нажатии на элемент.', example: 'b.onClick(() => sunnet.notify("Нажали"))' },
  { name: 'setText', sig: 'элемент.setText(текст)', text: 'Меняет текст элемента.', example: 'screen.find("Заголовок").setText("Привет!")' },
  { name: 'getText', sig: 'элемент.getText()', text: 'Возвращает текст элемента или то, что ввели в поле.', example: 'const name = screen.find("Имя").getText()' },
  { name: 'show', sig: 'элемент.show() / hide()', text: 'Показывает или прячет элемент.', example: 'screen.find("Подсказка").hide()' },
  { name: 'move', sig: 'элемент.move(x, y)', text: 'Передвигает элемент в точку (в пикселях).', example: 'screen.find("Солнце").move(20, 40)' },
  { name: 'style', sig: 'элемент.style(свойство, значение)', text: 'Меняет внешний вид (свойство CSS).', example: 'b.style("background", "#ff7a59")' },
  { name: 'animate', sig: 'элемент.animate(имя, { duration })', text: 'Проигрывает анимацию: pulse, float, spin, fade, pop.', example: 'b.animate("pop", { duration: 500 })' },
  { name: 'sunnet.notify', sig: 'sunnet.notify(текст)', text: 'Показывает уведомление Sunnet. Нужно разрешение «Уведомления».', example: 'sunnet.notify("Готово!")' },
  { name: 'sunnet.go', sig: 'sunnet.go(экран)', text: 'Переходит на другой экран приложения.', example: 'sunnet.go("Настройки")' },
  { name: 'sunnet.request', sig: 'sunnet.request(разрешение)', text: 'Просит разрешение: notifications, files, camera, microphone, screen. Пользователь решает сам.', example: 'sunnet.request("camera")' },
  { name: 'sunnet.state', sig: 'sunnet.state', text: 'Объект для своих данных, пока приложение открыто.', example: 'sunnet.state.count = (sunnet.state.count || 0) + 1' },
  { name: 'ui.button', sig: 'ui.button(текст)', text: 'Создаёт кнопку прямо из кода.', example: 'ui.button("Ещё").onClick(() => {})' },
  { name: 'ui.text', sig: 'ui.text(текст)', text: 'Добавляет строку текста из кода.', example: 'ui.text("Добро пожаловать")' },
];

const KNOWN = new Set(['notify', 'go', 'request', 'state', 'version']);

export interface Problem {
  line: number;
  text: string;
  hint?: string;
}

/** Проверка скрипта: синтаксис (разбор acorn, код не запускается) и неизвестные вызовы API. */
export function lint(code: string): Problem[] {
  const out: Problem[] = [];
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  } catch (e) {
    const err = e as { message?: string; loc?: { line: number } };
    out.push({ line: err.loc?.line ?? 0, text: `Ошибка в коде: ${translate(err.message ?? '')}`, hint: 'Проверьте скобки, кавычки и запятые рядом с этой строкой' });
  }
  code.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/sunnet\.(\w+)/g)) {
      if (!KNOWN.has(m[1]!)) {
        const near = [...KNOWN].find((k) => k.startsWith(m[1]!.slice(0, 3)));
        out.push({ line: i + 1, text: `«sunnet.${m[1]}» не существует`, hint: near ? `Вы имели в виду sunnet.${near}?` : 'Список команд — в документации API' });
      }
    }
    if (/\b(fetch|XMLHttpRequest|WebSocket)\b/.test(l)) out.push({ line: i + 1, text: 'Сеть в приложениях выключена ради безопасности', hint: 'Приложение работает в песочнице без доступа к интернету' });
  });
  return out;
}

/** Подсказки по набранному слову: «sunnet.» → список методов. */
export function suggest(prefix: string): ApiDoc[] {
  const p = prefix.trim();
  if (!p) return [];
  return API.filter((a) => a.name.startsWith(p) || a.name.split('.').pop()!.startsWith(p.split('.').pop() ?? '')).slice(0, 6);
}

export const PERMISSION_INFO: Record<string, { label: string; text: string }> = {
  notifications: { label: 'Уведомления', text: 'Показывать уведомления Sunnet' },
  files: { label: 'Файлы', text: 'Читать файлы, которые вы сами выберете' },
  camera: { label: 'Камера', text: 'Включать камеру — только после вашего разрешения и с индикатором' },
  microphone: { label: 'Микрофон', text: 'Включать микрофон — только после вашего разрешения и с индикатором' },
  screen: { label: 'Экран', text: 'Показывать ваш экран — каждый раз с подтверждением' },
};
