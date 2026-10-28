import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronRight, PanelLeftClose, Search, Star, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { SpaceSummary } from '@omni/shared';
import { findByPath, flatNodes, type NavNode, type NavSection } from '../navigation';
import { usePrefs } from '../../shared/stores/prefs';
import { useSession } from '../../shared/stores/session';
import { useUi } from '../../shared/stores/ui';
import { api } from '../../shared/api/client';
import { qk } from '../../shared/api/query';
import { cn } from '../../shared/lib/format';
import { IconButton } from '../../shared/ui';
import { useBadge } from './Rail';

function containsPath(node: NavNode, pathname: string): boolean {
  if (node.path && (pathname === node.path || pathname.startsWith(`${node.path}/`))) return true;
  return (node.children ?? []).some((c) => containsPath(c, pathname));
}

function matches(node: NavNode, q: string): boolean {
  const hay = `${node.label} ${(node.keywords ?? []).join(' ')}`.toLowerCase();
  return hay.includes(q) || (node.children ?? []).some((c) => matches(c, q));
}

function TreeRow({ node, depth, filter, onNavigate }: { node: NavNode; depth: number; filter: string; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const expanded = usePrefs((s) => s.expanded[node.id]);
  const toggleExpanded = usePrefs((s) => s.toggleExpanded);
  const favorites = usePrefs((s) => s.favorites);
  const toggleFavorite = usePrefs((s) => s.toggleFavorite);
  const role = useSession((s) => s.me?.role);
  const badge = useBadge(node.badge);
  const hasChildren = !!node.children?.length;
  const best = findByPath(pathname);
  const active = best?.node.id === node.id;
  const open = filter ? true : (expanded ?? true);
  const Icon = node.icon;
  const isFav = favorites.includes(node.id);
  // Пункты модерации видны только модераторам (сервер всё равно проверяет роль)
  if (node.adminOnly && role === 'user') return null;

  const content = (
    <>
      {hasChildren ? (
        <ChevronRight size={16} className={cn('tree__chevron', open && 'tree__chevron--open')} />
      ) : (
        Icon && (
          <span className="tree__icon">
            <Icon size={18} />
          </span>
        )
      )}
      {hasChildren && Icon && (
        <span className="tree__icon">
          <Icon size={18} />
        </span>
      )}
      <span className="tree__label">{node.label}</span>
      {node.planned && <span className="tree__soon">скоро</span>}
      {badge > 0 && <span className="badge">{badge}</span>}
      {node.path && !hasChildren && (
        <span
          role="button"
          tabIndex={-1}
          className={cn('icon-btn icon-btn--sm tree__star', isFav && 'tree__star--on')}
          aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}
          title={isFav ? 'Убрать из избранного' : 'Закрепить в избранном'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(node.id);
          }}
        >
          <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
        </span>
      )}
    </>
  );

  return (
    <li>
      {node.path && !hasChildren ? (
        <NavLink
          to={node.path}
          end
          onClick={onNavigate}
          className={cn('tree__row', active && 'tree__row--active', node.planned && 'tree__row--planned')}
          aria-current={active ? 'page' : undefined}
        >
          {content}
        </NavLink>
      ) : (
        <button className="tree__row" aria-expanded={open} onClick={() => toggleExpanded(node.id, !open)}>
          {content}
        </button>
      )}
      {hasChildren && open && (
        <ul className="tree">
          {node.children!.filter((c) => !filter || matches(c, filter)).map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} filter={filter} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Динамические подразделы: компании и сообщества пользователя появляются прямо в дереве. */
function useDynamicChildren(section: NavSection): NavNode[] {
  const kind = section.id === 'companies' ? 'company' : section.id === 'communities' ? 'community' : null;
  const { data } = useQuery({
    queryKey: ['spaces', kind ?? 'none'],
    queryFn: () => api.get<{ items: SpaceSummary[] }>(`/spaces?kind=${kind}`),
    enabled: !!kind,
  });
  return useMemo(
    () =>
      kind && data?.items.length
        ? [
            {
              id: `${section.id}.joined`,
              label: kind === 'company' ? 'Мои компании' : 'Я состою',
              children: data.items.map((s) => ({ id: `space.${s.id}`, label: s.name, path: `/${kind === 'company' ? 'companies' : 'communities'}/${s.id}` })),
            },
          ]
        : [],
    [kind, data, section.id],
  );
}

export function NavTreeView({ section, filter = '', onNavigate }: { section: NavSection; filter?: string; onNavigate?: () => void }) {
  const dynamic = useDynamicChildren(section);
  const favorites = usePrefs((s) => s.favorites);
  const favNodes = favorites.map((id) => flatNodes.find((f) => f.node.id === id)).filter((f) => !!f);
  const q = filter.trim().toLowerCase();
  const children = [...section.children, ...dynamic].filter((c) => !q || matches(c, q));
  return (
    <>
      {favNodes.length > 0 && !q && (
        <>
          <div className="section-nav__group-label">Избранные разделы</div>
          <ul className="tree">
            {favNodes.map((f) => (
              <TreeRow key={`fav-${f.node.id}`} node={f.node} depth={1} filter="" onNavigate={onNavigate} />
            ))}
          </ul>
          <div className="section-nav__group-label">{section.label}</div>
        </>
      )}
      <ul className="tree">
        {children.map((c) => (
          <TreeRow key={c.id} node={c} depth={0} filter={q} onNavigate={onNavigate} />
        ))}
      </ul>
      {q && children.length === 0 && <div className="muted small" style={{ padding: 12 }}>В этом разделе ничего не найдено. Попробуйте общий поиск: Ctrl+K</div>}
    </>
  );
}

export function SectionNav({ section }: { section: NavSection }) {
  const [filter, setFilter] = useState('');
  const setNavCollapsed = usePrefs((s) => s.set);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const setPalette = useUi((s) => s.setPalette);
  return (
    <aside className="section-nav pane" aria-label={`Навигация: ${section.label}`}>
      <div className="section-nav__head">
        <span className="section-nav__icon">
          <section.icon size={19} />
        </span>
        <div className="section-nav__title">{section.label}</div>
        <IconButton label="Поиск по всему приложению (Ctrl+K)" size="sm" onClick={() => setPalette(true)}>
          <Search size={18} />
        </IconButton>
        <IconButton
          label="Скрыть панель"
          size="sm"
          onClick={() => {
            setNavCollapsed({ navCollapsed: true });
            setNavOpen(false);
          }}
        >
          <PanelLeftClose size={18} />
        </IconButton>
      </div>
      <div className="section-nav__search">
        <div className="input-group">
          <Search size={16} className="input-group__icon" />
          <input className="input" placeholder="Найти подраздел" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Фильтр разделов" />
          {filter && (
            <button className="icon-btn icon-btn--sm input-group__action" onClick={() => setFilter('')} aria-label="Очистить">
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="section-nav__scroll">
        <NavTreeView section={section} filter={filter} onNavigate={() => setNavOpen(false)} />
      </div>
    </aside>
  );
}
