/** Окно облака: содержимое папки или корзина (восстановить / удалить навсегда). */
import { useRef } from 'react';
import { useParams } from 'react-router';
import { FolderPlus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { confirm } from '../../shared/ui/Modal';
import { createItem, deleteForever, openItemUrl, restoreItem, trashItem, uploadToDesk, useDeskItems, useTrash, type DeskItem } from './cloud';
import { openPath } from './fx';
import './cloud.css';

function Row({ item, trash }: { item: DeskItem; trash?: boolean }) {
  const open = () => {
    if (trash) return;
    if (item.kind === 'folder') return void openPath(`/cloud/${item.id}`);
    const url = openItemUrl(item);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
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

export function CloudPage() {
  const { folderId } = useParams();
  const isTrash = folderId === 'trash';
  const all = useDeskItems().data ?? [];
  const trash = useTrash(isTrash).data ?? [];
  const input = useRef<HTMLInputElement>(null);
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
