import { Link, useLocation } from 'react-router';
import { CheckCircle2, Construction, Map } from 'lucide-react';
import { findByPath, sectionFor, type NavNode } from '../../app/navigation';
import { ButtonLink, EmptyState } from '../../shared/ui';

/**
 * Страница-дорожная карта для разделов, которые уже есть в структуре,
 * но ещё не реализованы. Показывает, что именно в них появится.
 */
export function ComingSoon({ node }: { node?: NavNode }) {
  const { pathname } = useLocation();
  const found = node ? null : findByPath(pathname);
  const n = node ?? found?.node;
  const section = sectionFor(pathname);
  if (!n || !n.planned) return <NotFound />;
  const Icon = n.icon ?? Construction;
  return (
    <div className="scroll">
      <div className="page">
        <div className="card card--pad col gap-4" style={{ alignItems: 'flex-start', padding: 28 }}>
          <div className="empty__icon">
            <Icon size={30} />
          </div>
          <div>
            <span className="tag tag--accent">В разработке</span>
            <h1 style={{ marginTop: 10 }}>{n.label}</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Раздел уже встроен в навигацию и архитектуру SpaceUp. Вот что в нём появится:
            </p>
          </div>
          <ul className="col" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 10 }}>
            {n.planned.map((p) => (
              <li key={p} className="row" style={{ alignItems: 'flex-start' }}>
                <CheckCircle2 size={18} style={{ color: 'var(--accent-fg)', flex: '0 0 auto', marginTop: 2 }} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <ButtonLink to={section.path} variant="secondary" icon={<Map size={18} />}>
              Вернуться в «{section.label}»
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="scroll">
      <EmptyState
        icon={<Map size={28} />}
        title="Здесь ничего нет"
        text={
          <>
            Похоже, вы забрели в неизведанную часть лабиринта. Нажмите <span className="kbd">Ctrl K</span>, чтобы быстро найти нужный раздел.
          </>
        }
        action={<Link to="/chats" className="btn btn--primary">К чатам</Link>}
      />
    </div>
  );
}
