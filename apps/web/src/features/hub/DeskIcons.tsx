/**
 * Значки облака на рабочем столе: папки, файлы, проекты, серверы и сервисы.
 * Перетаскивание по сетке, рамка выделения, перетаскивание файлов с компьютера,
 * контекстное меню как в Windows и значки разрешений камеры/микрофона/экрана.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Camera, CameraOff, ClipboardPaste, Copy, ExternalLink, FileText, Folder, FolderOpen, Info, Mic, MicOff, Monitor, MonitorOff, Pencil, Pin, PinOff, Scissors, Server, ShieldCheck, ShieldAlert, Trash2, Boxes } from 'lucide-react';
import { cn } from '../../shared/lib/format';
import { toast } from '../../shared/stores/ui';
import { DeskMenu, type DeskMenuEntry, type MenuAnchor } from '../desktop/DeskMenu';
import { openPath } from '../desktop/fx';
import { catalogById } from './catalog';
import { useCloud, type DeskItem, type LivePerm } from './cloud';
import { AppGlyph } from './AppGlyph';
import { askPermission } from './PermissionPrompt';
import { useTaste } from './discover';

const CELL = { sm: { w: 84, h: 92 }, md: { w: 100, h: 108 }, lg: { w: 124, h: 132 } };
const TOP = 52;
const LEFT = 18;

export function openItem(item: DeskItem, admin = false) {
  const q = admin ? '&admin=1' : '';
  switch (item.kind) {
    case 'project':
      useTaste.getState().track('dev', 2);
      return openPath(`/studio?project=${item.id}${q}`);
    case 'server':
      useTaste.getState().track('chat', 1);
      return openPath(`/servers/new?id=${item.id}`);
    case 'folder':
      return openPath(`/cloud?folder=${item.id}`);
    case 'file':
      useTaste.getState().track('docs', 1);
      return openPath(`/cloud?file=${item.id}`);
    case 'app': {
      const app = item.appId ? catalogById.get(item.appId) : undefined;
      if (app) useTaste.getState().track(app.cat, 1);
      if (!app) return openPath(`/studio?project=${item.id}${q}`);
      if (app.via === 'sunnet') return openPath(app.url);
      // Сторонний сайт: в браузере — новая вкладка (встраивание запрещено самими сервисами)
      window.open(app.url, '_blank', 'noopener,noreferrer');
      return;
    }
  }
}

function ItemIcon({ item, size }: { item: DeskItem; size: number }) {
  const app = item.appId ? catalogById.get(item.appId) : undefined;
  if (app) return <AppGlyph app={app} size={size} />;
  const map = {
    folder: <Folder size={size * 0.78} />,
    file: <FileText size={size * 0.66} />,
    project: <Boxes size={size * 0.62} />,
    server: <Server size={size * 0.6} />,
    app: <Boxes size={size * 0.6} />,
  };
  return <span className={`desk-ico__glyph desk-ico__glyph--${item.kind}`} style={{ width: size, height: size }}>{map[item.kind]}</span>;
}

const PERM_ICONS: Record<LivePerm, [typeof Camera, typeof Camera, string]> = {
  camera: [Camera, CameraOff, 'Камера'],
  mic: [Mic, MicOff, 'Микрофон'],
  screen: [Monitor, MonitorOff, 'Экран'],
};

/** Три значка над приложением: перечёркнуты красным, пока разрешение не выдано. */
function PermBadges({ item }: { item: DeskItem }) {
  const grants = useCloud((s) => s.grants[item.id]);
  return (
    <span className="desk-ico__perms" onPointerDown={(e) => e.stopPropagation()}>
      {(Object.keys(PERM_ICONS) as LivePerm[]).map((p) => {
        const [On, Off, label] = PERM_ICONS[p];
        const on = !!grants?.[p];
        return (
          <button
            key={p}
            type="button"
            className={cn('desk-ico__perm', on ? 'desk-ico__perm--on' : 'desk-ico__perm--off')}
            title={`${label}: ${on ? 'разрешено — нажмите, чтобы отозвать' : 'нет доступа'}`}
            onClick={async () => {
              if (on) {
                useCloud.getState().grant(item.id, p, false);
                toast(`${label}: доступ для «${item.name}» отозван`);
              } else if (await askPermission(item, p)) useCloud.getState().grant(item.id, p, true);
            }}
          >
            {on ? <On size={11} /> : <Off size={11} />}
          </button>
        );
      })}
    </span>
  );
}

export function DeskIcons() {
  const all = useCloud((s) => s.items);
  const pinnedIds = useCloud((s) => s.pinned);
  // Закреплённое живёт в доке; открепили — вернулось на стол
  const items = all.filter((i) => !i.parent && !pinnedIds.includes(i.id));
  const selected = useCloud((s) => s.selected);
  const renaming = useCloud((s) => s.renaming);
  const pinned = useCloud((s) => s.pinned);
  const size = useCloud((s) => s.iconSize);
  const cell = CELL[size];
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; item: DeskItem } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [dropHover, setDropHover] = useState<string | null>(null);
  const [osDrop, setOsDrop] = useState(false);
  const start = useRef<{ x: number; y: number; id: string; moved: boolean } | null>(null);
  const st = useCloud.getState;

  // Файлы с компьютера: бросили на стол — они появляются в облаке
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      if ((e.target as HTMLElement).closest('.desk-win')) return;
      e.preventDefault();
      setOsDrop(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setOsDrop(false);
    };
    const drop = (e: DragEvent) => {
      setOsDrop(false);
      if (!e.dataTransfer?.files.length || (e.target as HTMLElement).closest('.desk-win')) return;
      e.preventDefault();
      for (const f of Array.from(e.dataTransfer.files)) {
        const kind = f.type === '' && f.size === 0 ? 'folder' : 'file';
        st().create(kind, f.name, { mime: f.type, size: f.size });
      }
      toast({ text: `Добавлено в облако: ${e.dataTransfer.files.length}`, kind: 'success' });
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [st]);

  // Клавиши: Delete, F2, Ctrl+C/X/V, Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable], .desk-win, .overlay')) return;
      const sel = st().selected;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Delete' && sel.length) st().remove(sel);
      else if (e.key === 'F2' && sel.length === 1) st().setRenaming(sel[0]!);
      else if (e.key === 'Enter' && sel.length === 1) {
        const it = st().items.find((i) => i.id === sel[0]);
        if (it) openItem(it);
      } else if (mod && e.code === 'KeyC' && sel.length) st().copy(sel);
      else if (mod && e.code === 'KeyX' && sel.length) st().copy(sel, true);
      else if (mod && e.code === 'KeyV') st().paste(null);
      else if (mod && e.code === 'KeyA') st().select(st().items.filter((i) => !i.parent).map((i) => i.id));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st]);

  const cellAt = (x: number, y: number) => ({ col: Math.max(0, Math.round((x - LEFT) / cell.w)), row: Math.max(0, Math.round((y - TOP) / cell.h)) });

  const itemMenu = (item: DeskItem): DeskMenuEntry[] => {
    const isPinned = pinned.includes(item.id);
    const runnable = item.kind === 'app' || item.kind === 'project';
    const g = st().grants[item.id] ?? {};
    return [
      { title: item.name },
      { label: 'Открыть', icon: <FolderOpen size={18} />, onClick: () => openItem(item) },
      runnable && { label: 'Запустить от имени администратора', icon: <ShieldCheck size={18} />, onClick: () => openItem(item, true) },
      runnable && (isPinned
        ? { label: 'Открепить от панели задач', icon: <PinOff size={18} />, onClick: () => st().unpin(item.id) }
        : { label: 'Закрепить на панели задач', icon: <Pin size={18} />, onClick: () => st().pin(item.id) }),
      runnable && 'separator',
      runnable && { title: 'Разрешения' },
      ...(runnable
        ? (Object.keys(PERM_ICONS) as LivePerm[]).map((p) => ({
            label: PERM_ICONS[p][2],
            checked: !!g[p],
            onClick: async () => {
              if (g[p]) st().grant(item.id, p, false);
              else if (await askPermission(item, p)) st().grant(item.id, p, true);
            },
          }))
        : []),
      'separator',
      { label: 'Переименовать', icon: <Pencil size={18} />, hint: 'F2', onClick: () => st().setRenaming(item.id) },
      { label: 'Копировать', icon: <Copy size={18} />, hint: 'Ctrl+C', onClick: () => st().copy([item.id]) },
      { label: 'Вырезать', icon: <Scissors size={18} />, hint: 'Ctrl+X', onClick: () => st().copy([item.id], true) },
      item.kind === 'folder' && { label: 'Вставить сюда', icon: <ClipboardPaste size={18} />, disabled: !st().clipboard, onClick: () => st().paste(item.id) },
      item.kind === 'app' && !!item.appId && catalogById.get(item.appId)?.via !== 'sunnet' && { label: 'Открыть сайт сервиса', icon: <ExternalLink size={18} />, onClick: () => window.open(catalogById.get(item.appId!)!.url, '_blank', 'noopener') },
      'separator',
      item.kind === 'app'
        ? { label: 'Удалить приложение', icon: <Trash2 size={18} />, danger: true, onClick: () => st().uninstall(item.id) }
        : { label: 'Удалить в корзину', icon: <Trash2 size={18} />, hint: 'Del', danger: true, onClick: () => st().remove([item.id]) },
      { label: 'Свойства', icon: <Info size={18} />, onClick: () => openPath(`/cloud?file=${item.id}`) },
    ];
  };

  return (
    <div className={cn('desk-icons', `desk-icons--${size}`, osDrop && 'desk-icons--drop')}>
      {osDrop && <div className="desk-icons__dropzone">Отпустите — файлы попадут в ваше облако Sunnet</div>}
      {items.map((item, idx) => {
        const isDrag = drag?.id === item.id;
        const style = {
          left: LEFT + item.col * cell.w + (isDrag ? drag.dx : 0),
          top: TOP + item.row * cell.h + (isDrag ? drag.dy : 0),
          width: cell.w,
          '--i': idx,
        } as CSSProperties;
        const runnable = item.kind === 'app' || item.kind === 'project';
        const app = item.appId ? catalogById.get(item.appId) : undefined;
        return (
          <div
            key={item.id}
            className={cn('desk-ico', selected.includes(item.id) && 'desk-ico--sel', isDrag && 'desk-ico--drag', dropHover === item.id && 'desk-ico--target', st().clipboard?.cut && st().clipboard?.ids.includes(item.id) && 'desk-ico--cut')}
            style={style}
            data-id={item.id}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              if (e.ctrlKey || e.metaKey) st().select(selected.includes(item.id) ? selected.filter((s) => s !== item.id) : [...selected, item.id]);
              else if (!selected.includes(item.id)) st().select([item.id]);
              start.current = { x: e.clientX, y: e.clientY, id: item.id, moved: false };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const s = start.current;
              if (!s || s.id !== item.id) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (!s.moved && Math.hypot(dx, dy) < 5) return;
              s.moved = true;
              setDrag({ id: item.id, dx, dy });
              const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset?.id && (el as HTMLElement).dataset.id !== item.id) as HTMLElement | undefined;
              const target = under ? st().items.find((i) => i.id === under.dataset.id && i.kind === 'folder') : undefined;
              setDropHover(target?.id ?? null);
            }}
            onPointerUp={(e) => {
              const s = start.current;
              start.current = null;
              if (s?.moved) {
                if (dropHover) {
                  st().moveInto(selected.includes(item.id) ? selected : [item.id], dropHover);
                  toast('Перемещено в папку');
                } else {
                  const c = cellAt(LEFT + item.col * cell.w + (e.clientX - s.x), TOP + item.row * cell.h + (e.clientY - s.y));
                  st().move(item.id, c.col, c.row);
                }
              }
              setDrag(null);
              setDropHover(null);
            }}
            onDoubleClick={() => openItem(item)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!selected.includes(item.id)) st().select([item.id]);
              setMenu({ anchor: { x: e.clientX, y: e.clientY }, item });
            }}
          >
            {runnable && <PermBadges item={item} />}
            <span className="desk-ico__tile">
              <ItemIcon item={item} size={size === 'sm' ? 40 : size === 'lg' ? 64 : 50} />
              {pinned.includes(item.id) && <Pin size={11} className="desk-ico__pin" />}
              {app && !app.verified && <ShieldAlert size={13} className="desk-ico__warn" />}
              {item.quarantined && <ShieldAlert size={13} className="desk-ico__warn" />}
            </span>
            {renaming === item.id ? (
              <input
                className="desk-ico__rename"
                defaultValue={item.name}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => st().rename(item.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') st().rename(item.id, e.currentTarget.value);
                  if (e.key === 'Escape') st().setRenaming(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="desk-ico__name">{item.name}</span>
            )}
          </div>
        );
      })}
      <DeskMenu anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} items={menu ? itemMenu(menu.item) : []} label="Значок" />
    </div>
  );
}
