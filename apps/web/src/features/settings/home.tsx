/**
 * Главная настроек в стиле iOS и Telegram: карточка аккаунта, поиск,
 * сгруппированные списки с цветными значками. Разделы с подпунктами
 * открываются отдельным списком (/settings?s=…), остальные — сразу.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, CircleHelp, Settings } from 'lucide-react';
import { sections, type NavNode } from '../../app/navigation';
import { useMe } from '../../shared/stores/session';
import { usePrefs } from '../../shared/stores/prefs';
import { cn } from '../../shared/lib/format';
import { Avatar, Verified } from '../../shared/ui';
import { SettingsSearch } from './search';
import '../misc/kit.css';
import './settings.css';

/** Цвет плитки значка для каждого раздела (как в настройках iOS) */
const TILE: Record<string, string> = {
  'settings.account': 'tile-blue',
  'settings.privacy': 'tile-gray',
  'settings.security': 'tile-green',
  'settings.notifications': 'tile-red',
  'settings.appearance': 'tile-violet',
  'settings.chats': 'tile-teal',
  'settings.calls': 'tile-green',
  'settings.space': 'tile-indigo',
  'settings.behavior': 'tile-gray',
  'settings.power': 'tile-yellow',
  'settings.data': 'tile-cyan',
  'settings.language': 'tile-purple',
  'settings.accessibility': 'tile-blue',
  'settings.shortcuts': 'tile-gray',
  'settings.admin': 'tile-orange',
  'settings.about': 'tile-gray',
};

/** Порядок и группы на главной настроек */
const GROUPS: string[][] = [
  ['settings.account', 'settings.privacy', 'settings.security', 'settings.notifications'],
  ['settings.appearance', 'settings.chats', 'settings.calls', 'settings.power', 'settings.behavior', 'settings.space'],
  ['settings.data', 'settings.language', 'settings.accessibility', 'settings.shortcuts'],
  ['settings.admin', 'settings.about'],
];

const THEME_LABEL: Record<string, string> = { dark: 'Тёмная', light: 'Светлая', system: 'Как в системе' };

function hint(id: string, theme: string | undefined): string | undefined {
  if (id === 'settings.language') return 'Русский';
  if (id === 'settings.appearance' && theme) return THEME_LABEL[theme];
  return undefined;
}

/** Строка списка: значок в цветном квадрате, подпись, значение и стрелка. */
export function NavRow({ node, tile, to, value }: { node: NavNode; tile: string; to: string; value?: string }) {
  const Icon = node.icon ?? Settings;
  return (
    <Link to={to} className="st-row">
      <span className={cn('st-row__icon', tile)}>
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <span className="st-row__label">{node.label}</span>
      {value && <span className="st-row__value">{value}</span>}
      <ChevronRight size={18} className="st-row__chevron" />
    </Link>
  );
}

export function SettingsHome() {
  const me = useMe();
  const theme = usePrefs((s) => s.theme);
  const [params] = useSearchParams();
  const [searching, setSearching] = useState(false);
  const settings = sections.find((s) => s.id === 'settings')!;
  const isAdmin = me.role === 'admin' || me.role === 'moderator';
  const nodes = new Map(settings.children.map((n) => [n.id, n]));
  const sub = params.get('s');
  const open = sub ? nodes.get(sub) : undefined;

  // Раздел с подпунктами — отдельный список
  if (open?.children) {
    const tile = TILE[open.id] ?? 'tile-gray';
    return (
      <div className="pk-root">
        <div className="scroll">
          <div className="st-page">
            <Link to="/settings" className="st-back">
              <ChevronLeft size={20} /> Настройки
            </Link>
            <h1 className="st-title">{open.label}</h1>
            <div className="st-group">
              <div className="st-card">
                {open.children
                  .filter((c) => !c.adminOnly || isAdmin)
                  .map((c) => (
                    <NavRow key={c.id} node={c} tile={tile} to={c.path ?? '/settings'} />
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const contact = me.phone || me.email;
  return (
    <div className="pk-root">
      <div className="scroll">
        <div className="st-page st-home">
          <h1 className="st-title">Настройки</h1>
          <Link to="/settings/account/profile" className="st-account">
            <Avatar src={me.avatarUrl} name={me.displayName} id={me.id} size={64} />
            <span className="st-account__text">
              <b>
                <span className="ellipsis">{me.displayName}</span>
                {me.verified && <Verified size={16} />}
              </b>
              <span>
                @{me.username}
                {contact ? ` · ${contact}` : ''}
              </span>
              {me.status && (
                <span className="st-account__status">
                  {me.status.emoji} {me.status.text}
                </span>
              )}
            </span>
            <ChevronRight size={20} className="st-row__chevron" />
          </Link>
          <div className="st-account-links">
            <Link to="/profile">Моя страница</Link>
            <Link to="/settings/account/profile">Изменить профиль</Link>
          </div>
          <SettingsSearch onActive={setSearching} />
          {!searching &&
            GROUPS.map((ids, gi) => {
              const rows = ids.map((id) => nodes.get(id)).filter((n): n is NavNode => !!n && (!n.adminOnly || isAdmin));
              if (!rows.length) return null;
              return (
                <div key={gi} className="st-group">
                  <div className="st-card">
                    {rows.map((n) => (
                      <NavRow key={n.id} node={n} tile={TILE[n.id] ?? 'tile-gray'} to={n.children ? `/settings?s=${n.id}` : (n.path ?? '/settings')} value={hint(n.id, theme)} />
                    ))}
                    {gi === GROUPS.length - 1 && (
                      <Link to="/help" className="st-row">
                        <span className="st-row__icon tile-blue">
                          <CircleHelp size={18} strokeWidth={2.2} />
                        </span>
                        <span className="st-row__label">Помощь</span>
                        <ChevronRight size={18} className="st-row__chevron" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          {!searching && (
            <>
              {/* Разделы, которых нет в группах выше (если появятся в реестре) — внизу, чтобы ничего не потерять */}
              {settings.children.some((n) => !GROUPS.flat().includes(n.id) && (!n.adminOnly || isAdmin)) && (
                <div className="st-group">
                  <div className="st-card">
                    {settings.children
                      .filter((n) => !GROUPS.flat().includes(n.id) && (!n.adminOnly || isAdmin))
                      .map((n) => (
                        <NavRow key={n.id} node={n} tile="tile-gray" to={n.children ? `/settings?s=${n.id}` : (n.path ?? '/settings')} />
                      ))}
                  </div>
                </div>
              )}
              <p className="st-footnote">Sunnet · версия 0.1.0</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
