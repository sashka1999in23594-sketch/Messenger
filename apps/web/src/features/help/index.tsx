import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Logo } from '../../shared/ui/Brand';
import { ContactsPage } from './ContactsPage';
import { FaqPage } from './FaqPage';
import { HELP_PATHS, SUPPORT_EMAIL, mailto } from './links';
import { PartnersPage } from './PartnersPage';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';
import { useDocumentTitle } from './ui';
import './help.css';

const NAV = [
  { to: HELP_PATHS.faq, label: 'Вопросы и ответы', end: true },
  { to: HELP_PATHS.partners, label: 'Сотрудничество' },
  { to: HELP_PATHS.privacy, label: 'Конфиденциальность' },
  { to: HELP_PATHS.terms, label: 'Условия' },
  { to: HELP_PATHS.contacts, label: 'Связаться' },
];

/**
 * Публичный сайт «Помощь и сотрудничество» — отдельный светлый сайт поверх приложения.
 * Монтируется как <Route path="/help/*" element={<HelpSite />} />, вход не нужен.
 */
export function HelpSite() {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const prevPath = useRef<string | null>(null);
  const { pathname, hash, key } = useLocation();

  // Смена страницы — в начало (и фокус на содержимое для экранных дикторов), якорь — к разделу
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const samePage = prevPath.current === pathname;
    const firstRender = prevPath.current === null;
    prevPath.current = pathname;
    const id = decodeURIComponent(hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target && root.contains(target)) {
      const smooth = samePage && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'instant' });
    } else {
      root.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (!firstRender && !samePage) mainRef.current?.focus({ preventScroll: true });
  }, [pathname, hash, key]);

  // На узком экране меню прокручивается — показываем активный пункт
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    // Список — position: relative, поэтому offsetLeft считается от его края
    const left = active.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = left - 16;
  }, [pathname]);

  return (
    <div className="help-site" ref={rootRef}>
      <div className="help-page">
        <a
          className="help-skip"
          href="#help-main"
          onClick={(e) => {
            e.preventDefault();
            mainRef.current?.focus();
          }}
        >
          Перейти к содержанию
        </a>

        <header className="help-header">
          <div className="help-container">
            <div className="help-header__top">
              <Link to={HELP_PATHS.faq} className="help-brand">
                <Logo size={32} />
                <span className="help-brand__name">Sunnet</span>
                <span className="help-brand__sep" aria-hidden>
                  ·
                </span>
                <span className="help-brand__section">Помощь</span>
              </Link>
              <Link to="/" className="help-open">
                Открыть Sunnet <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
          </div>
          <nav className="help-nav" aria-label="Разделы помощи">
            <ul ref={navRef} className="help-container">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink to={n.to} end={n.end} className="help-nav__link">
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <main className="help-main" id="help-main" ref={mainRef} tabIndex={-1}>
          <div className="help-container">
            <Routes>
              <Route index element={<FaqPage />} />
              <Route path="partners" element={<PartnersPage />} />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="terms" element={<TermsPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </main>

        <footer className="help-footer">
          <div className="help-container">
            <div className="help-footer__top">
              <Link to={HELP_PATHS.faq} className="help-footer__brand">
                <Logo size={24} />
                <span>Sunnet</span>
              </Link>
              <a className="help-footer__mail" href={mailto('Вопрос в поддержку Sunnet')}>
                {SUPPORT_EMAIL}
              </a>
            </div>
            <nav aria-label="Ссылки в подвале">
              <ul className="help-footer__links">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <Link to={n.to} className="help-footer__link">
                      {n.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/" className="help-footer__link">
                    Открыть Sunnet
                  </Link>
                </li>
              </ul>
            </nav>
            <p className="help-footer__copy">
              © {new Date().getFullYear()} Sunnet. Мессенджер и социальная платформа.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NotFound() {
  useDocumentTitle('Страница не найдена — Sunnet');
  return (
    <div className="help-head help-notfound">
      <p className="help-eyebrow">Ошибка 404</p>
      <h1>Такой страницы нет</h1>
      <p className="help-lead">
        Возможно, ссылка устарела или в адресе опечатка. Начните с{' '}
        <Link to={HELP_PATHS.faq}>вопросов и ответов</Link> или{' '}
        <Link to={HELP_PATHS.contacts}>напишите нам</Link>.
      </p>
    </div>
  );
}
