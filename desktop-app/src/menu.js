'use strict';
// Меню приложения и контекстное меню (правый клик) с русскими подписями.

const { app, clipboard, Menu } = require('electron');

const isMac = process.platform === 'darwin';
const separator = { type: 'separator' };

function buildAppMenu({ isDev }) {
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: `О программе ${app.name}` },
        separator,
        { role: 'services', label: 'Службы' },
        separator,
        { role: 'hide', label: `Скрыть ${app.name}` },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        separator,
        { role: 'quit', label: `Завершить ${app.name}` },
      ],
    });
  } else {
    template.push({ label: 'Файл', submenu: [{ role: 'quit', label: 'Выход' }] });
  }

  template.push({
    label: 'Правка',
    submenu: [
      { role: 'undo', label: 'Отменить' },
      { role: 'redo', label: 'Повторить' },
      separator,
      { role: 'cut', label: 'Вырезать' },
      { role: 'copy', label: 'Копировать' },
      { role: 'paste', label: 'Вставить' },
      ...(isMac ? [{ role: 'pasteAndMatchStyle', label: 'Вставить без форматирования' }] : []),
      { role: 'delete', label: 'Удалить' },
      separator,
      { role: 'selectAll', label: 'Выделить всё' },
    ],
  });

  template.push({
    label: 'Вид',
    submenu: [
      { role: 'reload', label: 'Обновить' },
      { role: 'forceReload', label: 'Обновить без кэша' },
      // Инструменты разработчика — только при запуске из исходников (npm start).
      ...(isDev ? [{ role: 'toggleDevTools', label: 'Инструменты разработчика' }] : []),
      separator,
      { role: 'resetZoom', label: 'Обычный масштаб' },
      { role: 'zoomIn', label: 'Увеличить' },
      // Ctrl/Cmd + «=» без Shift — привычное сочетание для увеличения.
      { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
      { role: 'zoomOut', label: 'Уменьшить' },
      separator,
      { role: 'togglefullscreen', label: 'Полноэкранный режим' },
    ],
  });

  template.push({
    label: 'Окно',
    role: 'window',
    submenu: isMac
      ? [
          { role: 'minimize', label: 'Свернуть' },
          { role: 'zoom', label: 'Масштаб' },
          separator,
          { role: 'front', label: 'Все окна — на передний план' },
        ]
      : [
          { role: 'minimize', label: 'Свернуть' },
          { role: 'close', label: 'Закрыть' },
        ],
  });

  return Menu.buildFromTemplate(template);
}

// Electron сам не показывает меню по правому клику — собираем короткое:
// варианты исправления опечатки, работа со ссылкой/картинкой и буфер обмена.
function attachContextMenu(win) {
  const contents = win.webContents;
  contents.on('context-menu', (_event, params) => {
    const items = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      items.push({
        label: 'Добавить в словарь',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push(separator);
    }

    if (/^(https?|mailto):/i.test(params.linkURL)) {
      items.push({ label: 'Копировать ссылку', click: () => clipboard.writeText(params.linkURL) });
      items.push(separator);
    }

    if (params.mediaType === 'image') {
      items.push({
        label: 'Копировать изображение',
        click: () => contents.copyImageAt(params.x, params.y),
      });
      items.push(separator);
    }

    if (params.isEditable) {
      const flags = params.editFlags;
      items.push(
        { role: 'cut', label: 'Вырезать', enabled: flags.canCut },
        { role: 'copy', label: 'Копировать', enabled: flags.canCopy },
        { role: 'paste', label: 'Вставить', enabled: flags.canPaste },
        separator,
        { role: 'selectAll', label: 'Выделить всё', enabled: flags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy', label: 'Копировать' });
    }

    while (items.length > 0 && items.at(-1).type === 'separator') items.pop();
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

module.exports = { buildAppMenu, attachContextMenu };
