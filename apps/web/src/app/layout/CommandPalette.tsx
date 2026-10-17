/**
 * Командная палитра (Ctrl/⌘+K): мгновенный переход в любой из десятков разделов,
 * поиск людей и чатов, быстрые действия. Главный инструмент, чтобы не заблудиться.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Hash, MessageCircle, Moon, PenLine, Search, Sun, UserRound } from 'lucide-react';
import type { SearchResults } from '@omni/shared';
import { flatNodes, sections, type FlatNode } from '../navigation';
import { api } from '../../shared/api/client';
import { useDebounced, useEscape } from '../../shared/hooks';
import { applyPrefs, usePrefs } from '../../shared/stores/prefs';
import { useUi } from '../../shared/stores/ui';
import { Avatar } from '../../shared/ui';

interface Item {
  key: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

function score(f: FlatNode, q: string): number {
  const label = f.node.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  const kw = (f.node.keywords ?? []).join(' ').toLowerCase();
  if (kw.includes(q)) return 50;
  const trail = f.trail.map((t) => t.label).join(' ').toLowerCase();
  if (trail.includes(q)) return 30;
  // Нечёткое совпадение: все буквы запроса по порядку
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const navigate = useNavigate();
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(q.trim(), 200);
  useEscape(() => setOpen(false), open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
      // Alt+1..9 — быстрый переход между разделами
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const s = sections[Number(e.key) - 1];
        if (s) {
          e.preventDefault();
          navigate(s.path);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const remote = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api.get<SearchResults>(`/search?q=${encodeURIComponent(debounced)}&type=all&limit=5`),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    const go = (path: string, id?: string) => () => {
      if (id) prefs.pushRecent(id);
      navigate(path);
      setOpen(false);
    };
    const nodeItem = (f: FlatNode, group: string): Item => {
      const Icon = f.node.icon ?? f.section.icon;
      return {
        key: `${group}-${f.node.id}`,
        group,
        label: f.node.label,
        hint: [...f.trail.map((t) => t.label)].join(' › '),
        icon: <Icon size={18} />,
        run: go(f.node.path!, f.node.id),
      };
    };
    const query = q.trim().toLowerCase();
    const out: Item[] = [];
    const actions: Item[] = [
      { key: 'a-post', group: 'Действия', label: 'Написать пост', icon: <PenLine size={18} />, run: go('/feed/compose') },
      { key: 'a-chat', group: 'Действия', label: 'Новый чат', icon: <MessageCircle size={18} />, run: go('/chats/new/direct') },
      {
        key: 'a-theme',
        group: 'Действия',
        label: document.documentElement.dataset.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
        icon: document.documentElement.dataset.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />,
        run: () => {
          const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
          prefs.set({ theme });
          applyPrefs({ ...prefs, theme });
          setOpen(false);
        },
      },
    ];
    if (!query) {
      const fav = prefs.favorites.map((id) => flatNodes.find((f) => f.node.id === id)).filter((f): f is FlatNode => !!f?.node.path);
      const recent = prefs.recent.map((id) => flatNodes.find((f) => f.node.id === id)).filter((f): f is FlatNode => !!f?.node.path);
      out.push(...fav.map((f) => nodeItem(f, 'Избранные разделы')));
      out.push(...recent.filter((f) => !prefs.favorites.includes(f.node.id)).map((f) => nodeItem(f, 'Недавние')));
      out.push(...actions);
      out.push(...sections.map((s) => ({ key: `s-${s.id}`, group: 'Разделы', label: s.label, hint: s.description, icon: <s.icon size={18} />, run: go(s.path) })));
      return out;
    }
    const nodes = flatNodes
      .filter((f) => f.node.path)
      .map((f) => ({ f, s: score(f, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    out.push(...nodes.map(({ f }) => nodeItem(f, 'Разделы')));
    out.push(...actions.filter((a) => a.label.toLowerCase().includes(query)));
    const r = remote.data;
    if (r) {
      out.push(
        ...r.users.map((u) => ({
          key: `u-${u.id}`,
          group: 'Люди',
          label: u.displayName,
          hint: `@${u.username}`,
          icon: <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={24} />,
          run: go(`/u/${u.username}`),
        })),
        ...r.chats.map((c) => ({ key: `c-${c.id}`, group: 'Каналы и группы', label: c.title, hint: c.handle ? `@${c.handle}` : undefined, icon: <MessageCircle size={18} />, run: go(`/chats/${c.id}`) })),
        ...r.hashtags.map((h) => ({ key: `h-${h.tag}`, group: 'Хэштеги', label: `#${h.tag}`, hint: `${h.count}`, icon: <Hash size={18} />, run: go(`/tag/${encodeURIComponent(h.tag)}`) })),
      );
    }
    out.push({ key: 'search-all', group: 'Поиск', label: `Искать «${q.trim()}» везде`, icon: <Search size={18} />, run: go(`/search?q=${encodeURIComponent(q.trim())}`) });
    return out;
  }, [q, remote.data, prefs, navigate, setOpen]);

  useEffect(() => setSel(0), [q]);
  if (!open) return null;

  let lastGroup = '';
  return createPortal(
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Поиск и навигация">
        <div className="palette__input">
          <Search size={20} className="faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Куда перейти? Раздел, человек, канал, #тег…"
            aria-label="Поиск"
            role="combobox"
            aria-expanded
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((v) => Math.min(items.length - 1, v + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === 'Enter') {
                items[sel]?.run();
              }
            }}
          />
        </div>
        <div className="palette__list" role="listbox">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="palette__group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {header}
                <button className="palette__item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}>
                  <span className="tree__icon">{it.icon}</span>
                  <span className="col grow" style={{ gap: 0 }}>
                    <span className="ellipsis">{it.label}</span>
                    {it.hint && <span className="palette__path ellipsis">{it.hint}</span>}
                  </span>
                  {i === sel && <CornerDownLeft size={16} className="faint" />}
                </button>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="empty" style={{ padding: 32 }}>
              <UserRound size={24} />
              Ничего не найдено
            </div>
          )}
        </div>
        <div className="palette__foot">
          <span>
            <span className="kbd">↑↓</span> выбор
          </span>
          <span>
            <span className="kbd">Enter</span> перейти
          </span>
          <span>
            <span className="kbd">Alt+1…9</span> разделы
          </span>
          <span>
            <span className="kbd">Esc</span> закрыть
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
