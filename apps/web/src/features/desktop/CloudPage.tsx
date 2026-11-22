/** Окно облака: содержимое папки или корзина (восстановить / удалить навсегда). */
import { openWeb } from '../apps/openWeb';
import { useRef } from 'react';
import { useParams } from 'react-router';
import { ArchiveRestore, DownloadCloud, FolderPlus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { confirm } from '../../shared/ui/Modal';
import { createItem, deleteForever, openItemUrl, restoreItem, trashItem, uploadToDesk, useDeskItems, useTrash, type DeskItem } from './cloud';
import { openPath } from './fx';
import './cloud.css';

function Row({ item, trash }: { item: DeskItem; trash?: boolean }) {
  const open = () => {
    if (trash) return;
    if (item.kind === 'folder') return void openPath(`/cloud/${item.id}`);
    const url = openItemUrl(item);
    if (!url) return;
    // Ярлык сайта или приложения — во встроенном браузере Sunnet; файл — как раньше
    if (item.kind === 'link') openWeb(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  return (
    <li className="cloud-row" onDoubleClick={open}>
      <span className={`cloud-row__icon cloud-row__icon--${item.kind}`} aria-hidden />
      <span className="cloud-row__name">{item.name}</span>
      <span className="cloud-row__meta">{item.kind === 'folder' ? 'Папка' : item.kind === 'link' ? 'Ярлык' : item.kind === 'project' ? 'Проект' : (item.media?.mime ?? 'Файл')}</span>
      {trash ? (
        <span className="cloud-row__actions">
          <button type="button" onClick={() => void restoreItem(item.id)}>
            <RotateCcw size={15} /> Вернуть
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={async () => {
              if (await confirm({ title: `Удалить «${item.name}» навсегда?`, text: 'Вернуть его будет нельзя.', confirmLabel: 'Удалить', danger: true })) void deleteForever(item.id);
            }}
          >
            <Trash2 size={15} /> Навсегда
          </button>
        </span>
      ) : (
        <span className="cloud-row__actions">
          <button type="button" onClick={open}>
            Открыть
          </button>
          <button type="button" className="is-danger" onClick={() => void trashItem(item)} aria-label={`В корзину: ${item.name}`}>
            <Trash2 size={15} />
          </button>
        </span>
      )}
    </li>
  );
}

/** Копия облака в файл на компьютере (файлы — ссылками на ваши загрузки, проекты — целиком). */
async function saveBackup() {
  try {
    const data = await api.get('/desk/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sunnet-oblako-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast({ text: 'Копия облака сохранена', kind: 'success' });
  } catch (e) {
    toast({ text: errorMessage(e), kind: 'error' });
  }
}

/** Восстановление: недостающее создаётся заново, существующее не трогается. */
async function restoreBackup(file: File) {
  try {
    const json = JSON.parse(await file.text()) as { items?: unknown[] };
    if (!Array.isArray(json.items)) throw new Error('Это не файл копии Sunnet');
    const r = await api.post<{ restored: number; skipped: number }>('/desk/restore', { items: json.items });
    await queryClient.invalidateQueries({ queryKey: ['desk-items'] });
    toast({ text: `Восстановлено: ${r.restored}${r.skipped ? ` · пропущено: ${r.skipped} (файлов уже нет в хранилище)` : ''}`, kind: 'success' });
  } catch (e) {
    toast({ text: e instanceof SyntaxError ? 'Файл повреждён' : errorMessage(e), kind: 'error' });
  }
}

export function CloudPage() {
  const { folderId } = useParams();
  const isTrash = folderId === 'trash';
  const all = useDeskItems().data ?? [];
  const trash = useTrash(isTrash).data ?? [];
  const input = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const parent = isTrash ? null : (folderId ?? null);
  const list = isTrash ? trash : all.filter((i) => i.parentId === parent);
  const folder = all.find((i) => i.id === folderId);
  const title = isTrash ? 'Корзина' : (folder?.name ?? 'Облако');

  return (
    <div
      className="scroll cloud"
      onDragOver={(e) => !isTrash && e.preventDefault()}
      onDrop={(e) => {
        if (isTrash) return;
        e.preventDefault();
        void uploadToDesk([...e.dataTransfer.files], { x: 0, y: 0 }, parent);
      }}
    >
      <header className="cloud__head">
        <h1>{title}</h1>
        {!isTrash && (
          <div className="cloud__tools">
            <button type="button" onClick={() => void createItem({ kind: 'folder', name: 'Новая папка', parentId: parent })}>
              <FolderPlus size={16} /> Папка
            </button>
            <button type="button" onClick={() => input.current?.click()}>
              <Upload size={16} /> Загрузить
            </button>
            <button type="button" onClick={() => void openPath('/cloud/trash')}>
              <Trash2 size={16} /> Корзина
            </button>
            {!parent && (
              <>
                <button type="button" onClick={() => void saveBackup()} title="Скачать копию папок, ярлыков и проектов">
                  <DownloadCloud size={16} /> Копия
                </button>
                <button type="button" onClick={() => restoreInput.current?.click()} title="Восстановить из файла копии">
                  <ArchiveRestore size={16} /> Восстановить
                </button>
                <input
                  ref={restoreInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void restoreBackup(f);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void uploadToDesk([...e.target.files], { x: 0, y: 0 }, parent)} />
          </div>
        )}
      </header>
      {isTrash && <p className="cloud__note">Удалённое хранится здесь, пока вы не удалите его навсегда.</p>}
      {list.length ? (
        <ul className="cloud__list">
          {list.map((i) => (
            <Row key={i.id} item={i} trash={isTrash} />
          ))}
        </ul>
      ) : (
        <p className="cloud__empty">{isTrash ? 'Корзина пуста' : 'Здесь пока пусто — перетащите файлы в окно'}</p>
      )}
    </div>
  );
}
