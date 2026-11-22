/**
 * Значки облака на рабочем столе. Перетаскивание по сетке (позиция сохраняется
 * на сервере), бросок на папку — переложить внутрь, двойной щелчок — открыть,
 * правый щелчок — меню, F2 — переименовать, Delete — в корзину.
 */
import { openWeb } from '../apps/openWeb';
import { useRef, useState, type CSSProperties } from 'react';
import { Pin, ShieldCheck, FileArchive, FileText, Film, Folder, Globe, Image as ImageIcon, Music, PenLine, Sparkles, Trash2, ExternalLink, FolderOpen } from 'lucide-react';
import { DeskMenu, useDeskMenu } from './DeskMenu';
import { openMaximized, openPath } from './fx';
import { MENUBAR_H } from './geometry';
import { isInternal, moveItem, openItemUrl, renameItem, trashItem, useDeskItems, type DeskItem } from './cloud';
import { pinToDock, runAsAdmin, useDeskPrefs } from './deskPrefs';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { Camera, Mic, Monitor } from 'lucide-react';

/**
 * Камера, микрофон и экран над значком приложения: перечёркнуто красным — доступа нет,
 * зелёным — разрешено. Показываем для приложений, которые работают внутри Sunnet.
 */
function PermBadges({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['studio-app', slug], queryFn: () => api.get<{ granted: string[] }>(`/studio/apps/${slug}`), staleTime: 30_000, retry: false });
  const g = q.data?.granted ?? [];
  const item = (key: string, icon: React.ReactNode, label: string) => (
    <i className={g.includes(key) ? 'is-on' : 'is-off'} title={`${label}: ${g.includes(key) ? 'разрешено' : 'нет доступа'}`}>
      {icon}
    </i>
  );
  return (
    <span className="dperm" aria-label="Разрешения приложения">
      {item('camera', <Camera size={9} />, 'Камера')}
      {item('microphone', <Mic size={9} />, 'Микрофон')}
      {item('screen', <Monitor size={9} />, 'Экран')}
    </span>
  );
}

export const CELL_W = 96;
export const CELL_H = 106;
export const GRID_LEFT = 18;
export const GRID_TOP = MENUBAR_H + 14;
const ROWS = () => Math.max(3, Math.floor((window.innerHeight - GRID_TOP - 110) / CELL_H));

/** Ячейка сетки по точке на экране. */
export function cellAt(px: number, py: number) {
  return { x: Math.max(0, Math.round((px - GRID_LEFT - CELL_W / 2) / CELL_W)), y: Math.min(ROWS() - 1, Math.max(0, Math.round((py - GRID_TOP - CELL_H / 2) / CELL_H))) };
}

function glyph(item: DeskItem) {
  if (item.kind === 'folder') return <span className="dicon__folder" aria-hidden />;
  if (item.kind === 'project') return <Sparkles size={26} />;
  if (item.kind === 'link') return <Globe size={26} />;
  const k = item.media?.kind;
  if (k === 'image') return item.media?.url ? <img className="dicon__thumb" src={item.media.url} alt="" draggable={false} /> : <ImageIcon size={26} />;
  if (k === 'video') return <Film size={26} />;
  if (k === 'audio') return <Music size={26} />;
  if (item.media?.mime === 'application/zip') return <FileArchive size={26} />;
  return <FileText size={26} />;
}

/** Раскладка: у кого нет позиции — встают в первые свободные ячейки по столбцам. */
function layout(items: DeskItem[]) {
  const rows = ROWS();
  const taken = new Set<string>();
  const placed = new Map<string, { x: number; y: number }>();
  for (const i of items) if (i.x !== null && i.y !== null && !taken.has(`${i.x}:${i.y}`)) (taken.add(`${i.x}:${i.y}`), placed.set(i.id, { x: i.x, y: Math.min(i.y, rows - 1) }));
  let c = 0;
  for (const i of items) {
    if (placed.has(i.id)) continue;
    while (taken.has(`${Math.floor(c / rows)}:${c % rows}`)) c++;
    const p = { x: Math.floor(c / rows), y: c % rows };
    taken.add(`${p.x}:${p.y}`);
    placed.set(i.id, p);
  }
  return placed;
}

export function DeskIcons() {
  const items = useDeskItems().data ?? [];
  const size = useDeskPrefs((s) => s.iconSize);
  const root = items.filter((i) => !i.parentId);
  const pos = layout(root);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; over: string | null } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const menu = useDeskMenu();
  const [menuFor, setMenuFor] = useState<DeskItem | null>(null);

  const open = (item: DeskItem) => {
    if (item.kind === 'folder') return void openPath(`/cloud/${item.id}`);
    if (item.kind === 'project') return void openMaximized(`/studio/${item.id}`);
    if (isInternal(item)) return void openPath(item.url!);
    const url = openItemUrl(item);
    if (!url) return;
    // Ярлык сайта или приложения — во встроенном браузере Sunnet; файл — как раньше
    if (item.kind === 'link') openWeb(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onDown = (e: React.PointerEvent, item: DeskItem) => {
    if (e.button !== 0 || editing === item.id) return;
    setSel(item.id);
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent, item: DeskItem) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < 5) return;
    s.moved = true;
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.folder && el.dataset.folder !== item.id) as HTMLElement | undefined;
    setDrag({ id: item.id, dx, dy, over: under?.dataset.folder ?? null });
  };
  const onUp = (e: React.PointerEvent, item: DeskItem) => {
    const s = start.current;
    start.current = null;
    if (!s?.moved || !drag) return setDrag(null);
    if (drag.over) moveItem(item.id, { parentId: drag.over });
    else {
      const c = cellAt(e.clientX, e.clientY);
      const busy = root.some((o) => o.id !== item.id && pos.get(o.id)?.x === c.x && pos.get(o.id)?.y === c.y);
      if (!busy) moveItem(item.id, c);
    }
    setDrag(null);
  };

  return (
    <div className={`dicons dicons--${size}`} aria-label="Облако на рабочем столе">
      <SystemIcons />
      {root.map((item, i) => {
        const p = pos.get(item.id)!;
        const dragging = drag?.id === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`dicon dicon--${item.kind}${sel === item.id ? ' is-sel' : ''}${dragging ? ' is-drag' : ''}${drag?.over === item.id ? ' is-target' : ''}`}
            data-folder={item.kind === 'folder' ? item.id : undefined}
            style={
              {
                left: GRID_LEFT + p.x * CELL_W,
                top: GRID_TOP + p.y * CELL_H,
                '--i': Math.min(i, 20),
                transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.06)` : undefined,
              } as CSSProperties
            }
            onPointerDown={(e) => onDown(e, item)}
            onPointerMove={(e) => onMove(e, item)}
            onPointerUp={(e) => onUp(e, item)}
            onDoubleClick={() => open(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') open(item);
              else if (e.key === 'F2') setEditing(item.id);
              else if (e.key === 'Delete') void trashItem(item);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSel(item.id);
              setMenuFor(item);
              menu.open({ x: e.clientX, y: e.clientY });
            }}
            aria-label={item.name}
          >
            {item.kind === 'link' && item.url?.startsWith('/app/') && <PermBadges slug={item.url.slice(5)} />}
            <span className="dicon__tile">{glyph(item)}</span>
            {editing === item.id ? (
              <input
                className="dicon__edit"
                defaultValue={item.name}
                autoFocus
                maxLength={120}
                aria-label="Новое имя"
                onFocus={(e) => e.currentTarget.select()}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (void renameItem(item.id, e.currentTarget.value), setEditing(null));
                  if (e.key === 'Escape') setEditing(null);
                }}
                onBlur={(e) => (void renameItem(item.id, e.currentTarget.value), setEditing(null))}
              />
            ) : (
              <span className="dicon__name">{item.name}</span>
            )}
          </button>
        );
      })}
      <DeskMenu
        anchor={menu.anchor}
        onClose={() => (menu.close(), setMenuFor(null))}
        label={menuFor?.name ?? 'Значок'}
        items={
          menuFor
            ? [
                { label: 'Открыть', icon: menuFor.kind === 'folder' ? <FolderOpen size={18} /> : <ExternalLink size={18} />, onClick: () => open(menuFor) },
                menuFor.kind === 'link' && { label: 'Запустить от имени администратора', icon: <ShieldCheck size={18} />, onClick: () => void runAsAdmin(menuFor.url ?? '/', menuFor.name) },
                isInternal(menuFor) && { label: 'Закрепить на панели задач', icon: <Pin size={18} />, onClick: () => void pinToDock(menuFor) },
                'separator',
                { label: 'Переименовать', icon: <PenLine size={18} />, hint: 'F2', onClick: () => setEditing(menuFor.id) },
                { label: 'В корзину', icon: <Trash2 size={18} />, hint: 'Delete', danger: true, onClick: () => void trashItem(menuFor) },
                'separator',
                { label: 'Открыть облако', icon: <Folder size={18} />, onClick: () => void openPath('/cloud') },
              ]
            : []
        }
      />
    </div>
  );
}

/**
 * Системные значки рабочего стола — Браузер и Корзина. Стоят справа, удалить или
 * открепить их нельзя (как «Корзину» в Windows); в меню — только «Открыть».
 */
function SystemIcons() {
  const [menu, setMenu] = useState<{ x: number; y: number; open: () => void } | null>(null);
  const items = [
    { id: 'browser', name: 'Браузер', icon: <Globe size={30} />, open: () => openMaximized('/browser') },
    { id: 'trash', name: 'Корзина', icon: <Trash2 size={28} />, open: () => openPath('/cloud/trash') },
  ];
  return (
    <div className="dsys" aria-label="Системные значки">
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          className={`dicon dicon--sys dicon--sys-${it.id}`}
          style={{ '--i': i } as CSSProperties}
          onDoubleClick={it.open}
          onKeyDown={(e) => e.key === 'Enter' && it.open()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY, open: it.open });
          }}
        >
          <span className="dicon__tile">{it.icon}</span>
          <span className="dicon__name">{it.name}</span>
        </button>
      ))}
      {menu && (
        <DeskMenu
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          label="Системный значок"
          items={[{ label: 'Открыть', icon: <FolderOpen size={18} />, onClick: menu.open }]}
        />
      )}
    </div>
  );
}
