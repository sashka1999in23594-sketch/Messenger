# Sunnet для компьютера

Приложение для Windows, macOS и Linux — тонкая обёртка на Electron над сайтом Sunnet
(`https://omni-w0fb.onrender.com`). Вся логика мессенджера живёт на сайте: обновили сайт — обновилось
и приложение, пересобирать ничего не нужно.

Папка намеренно лежит вне npm workspaces (`packages/*`, `apps/*`): сборка сайта на Render делает
`npm ci` в корне и не должна скачивать Electron.

## Что умеет

- одно окно (повторный запуск показывает уже открытое), запоминает размер, положение и развёрнутость;
- камера, микрофон, уведомления, буфер обмена и полноэкранный режим — только для сайта Sunnet,
  остальные разрешения запрещены; демонстрация экрана отдаёт основной монитор;
- ссылки на другие сайты и `mailto:` открываются в браузере и почтовой программе;
- пока сервер просыпается или нет сети — экран загрузки: закат с лучами, которые следуют за мышью (а без движения мыши оживают сами), и прогресс внизу; как только сервер ответил, открывается Sunnet
- обновления как у игровых лаунчеров: при запуске приложение проверяет GitHub Releases и, если вышла новая версия, показывает окно с прогрессом загрузки, ставит её и перезапускается (Windows и Linux AppImage; на macOS без подписи Apple — ссылка на скачивание)
- в Windows ярлыки на рабочем столе и в меню «Пуск» днём называются «Sunnet» с закатом, ночью — «Lynnet» с луной; старый ярлык «SpaceUp» убирается. Анимацию значка рабочего стола при наведении Windows не поддерживает — значок ярлыка всегда статичная картинка
  (проверка каждые 10 секунд);
- проверка орфографии (русский и английский), меню по правому клику, русское меню приложения.

## Разработка

```bash
cd desktop-app
npm install
npm start                                     # открыть приложение из исходников
SPACEUP_URL=http://localhost:5173 npm start   # открыть локальную версию сайта
```

Файлы: `src/main.js` — окно и жизненный цикл, `src/security.js` — разрешения и ссылки,
`src/menu.js` — меню, `src/window-state.js` — размеры окна, `src/loading.html` — экран загрузки, `src/update.html` и `src/updater.js` — обновления, `src/shortcuts.js` — ярлыки Sunnet/Lynnet,
`build/` — значки (`icon.png` для Windows, `icon-mac.png` с отступами по сетке Apple, `icons/` для Linux).

## Сборка

Локально (собирается только под текущую систему; macOS-версию можно собрать только на Mac):

```bash
npm run dist -- --linux   # Sunnet.AppImage и sunnet_amd64.deb
npm run dist -- --win     # Sunnet-Setup.exe
npm run dist -- --mac     # Sunnet-mac-arm64.dmg и Sunnet-mac-x64.dmg
```

`npm run dist` сначала записывает `src/config.json` с адресом сайта (`SPACEUP_URL` или адрес по умолчанию).

## Выпуск новой версии

1. Поднимите `version` в `desktop-app/package.json`.
2. Отправьте изменения в `main` — workflow «Приложения для компьютера»
   (`.github/workflows/desktop.yml`) соберёт приложение на Windows, macOS и Linux и опубликует релиз
   `desktop-v<версия>`. Его можно запустить и вручную на вкладке Actions.

Ссылки на скачивание постоянные — без версии в имени файла:

- `https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download/Sunnet-Setup.exe`
- `https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download/Sunnet-mac-arm64.dmg`
- `https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download/Sunnet-mac-x64.dmg`
- `https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download/Sunnet.AppImage`
- `https://github.com/sashka1999in23594-sketch/Messenger/releases/latest/download/sunnet_amd64.deb`

## Подпись и предупреждения

Сертификатов разработчика нет, поэтому при первом запуске система переспрашивает:
Windows SmartScreen — «Подробнее» → «Выполнить в любом случае»; macOS — «Системные настройки» →
«Конфиденциальность и безопасность» → «Всё равно открыть» (сборка для macOS подписана ad-hoc,
без сертификата Apple). Для демонстрации экрана на macOS нужно разрешить Sunnet «Запись экрана».
