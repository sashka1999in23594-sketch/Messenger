import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Check, ChevronDown, Link2, Mail, Search, X } from 'lucide-react';
import { FAQ, type FaqItem } from './faq';
import { HELP_PATHS, SUPPORT_EMAIL, mailto } from './links';
import { Blocks, Highlight, normalize, plainText } from './rich';
import { plural, useDocumentTitle } from './ui';

const ITEM_IDS = new Set(FAQ.flatMap((t) => t.items.map((it) => it.id)));
const TOPIC_IDS = new Set(FAQ.map((t) => t.id));
/** Поисковый индекс: вопрос + синонимы + текст ответа */
const INDEX = FAQ.flatMap((t) =>
  t.items.map((it) => ({
    id: it.id,
    text: normalize(`${t.title} ${it.q} ${it.keywords ?? ''} ${plainText(it.a)}`),
  })),
);

export function FaqPage() {
  useDocumentTitle('Помощь — Sunnet');
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [seenKey, setSeenKey] = useState<string | null>(null);

  // Переход по ссылке /help#calls раскрывает вопрос ещё до отрисовки,
  // чтобы оболочка сайта сразу прокрутила к нему
  if (location.key !== seenKey) {
    setSeenKey(location.key);
    const id = decodeURIComponent(location.hash.slice(1));
    if (ITEM_IDS.has(id) && !open.has(id)) setOpen(new Set(open).add(id));
    if ((ITEM_IDS.has(id) || TOPIC_IDS.has(id)) && query) setQuery('');
  }

  // Грубая «основа» слова: «звонок» найдёт и «звонке», «пароль» — «пароля»
  const words = useMemo(
    () =>
      normalize(query)
        .split(/[\s,.!?;:«»"()]+/)
        .filter(Boolean)
        .map((w) => (w.length >= 5 ? w.slice(0, Math.max(4, w.length - 2)) : w)),
    [query],
  );
  const matched = useMemo(
    () =>
      words.length
        ? new Set(INDEX.filter((e) => words.every((w) => e.text.includes(w))).map((e) => e.id))
        : null,
    [words],
  );
  const topics = matched
    ? FAQ.map((t) => ({ ...t, items: t.items.filter((it) => matched.has(it.id)) })).filter(
        (t) => t.items.length > 0,
      )
    : FAQ;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header className="help-head help-hero">
        <p className="help-eyebrow">Центр помощи</p>
        <h1>Чем мы можем помочь?</h1>
        <p className="help-lead">
          Ответы на частые вопросы о входе, звонках, чатах и безопасности. Не нашли нужное —{' '}
          <Link to={HELP_PATHS.contacts}>напишите нам</Link>.
        </p>
        <form className="help-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="help-q" className="help-sr">
            Поиск по вопросам и ответам
          </label>
          <Search className="help-search__icon" size={20} aria-hidden />
          <input
            id="help-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Например: не приходит код"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={100}
          />
          {query && (
            <button
              type="button"
              className="help-search__clear"
              aria-label="Очистить поиск"
              onClick={() => setQuery('')}
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </form>
        <p className="help-search__status" aria-live="polite">
          {matched &&
            (matched.size
              ? `Нашлось ${matched.size} ${plural(matched.size, ['ответ', 'ответа', 'ответов'])}`
              : 'Ничего не нашлось')}
        </p>
        {!matched && (
          <nav aria-label="Темы">
            <ul className="help-chips">
              {FAQ.map((t) => (
                <li key={t.id}>
                  <Link to={{ hash: t.id }} className="help-chip">
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      {topics.map((t) => (
        <section key={t.id} id={t.id} className="help-topic" aria-labelledby={`${t.id}-title`}>
          <h2 id={`${t.id}-title`}>{t.title}</h2>
          <div className="help-faq">
            {t.items.map((it) => (
              <Question
                key={it.id}
                item={it}
                open={open.has(it.id)}
                onToggle={() => toggle(it.id)}
                words={words}
              />
            ))}
          </div>
        </section>
      ))}

      {matched && matched.size === 0 && (
        <div className="help-empty">
          <p>
            <strong>По запросу «{query.trim()}» ответов нет.</strong>
          </p>
          <p>
            Попробуйте другие слова — например, «пароль», «звонок» или «удалить аккаунт». Или
            напишите нам, ответим лично.
          </p>
          <button type="button" className="help-btn" onClick={() => setQuery('')}>
            Показать все вопросы
          </button>
        </div>
      )}

      <section className="help-callout" aria-labelledby="help-ask-title">
        <h2 id="help-ask-title">Не нашли ответ?</h2>
        <p>
          Напишите нам на почту — ответит человек из команды Sunnet, обычно в течение 1–2 рабочих
          дней. Расскажите, что случилось, и укажите имя пользователя, устройство и браузер.
        </p>
        <div className="help-actions">
          <a className="help-btn help-btn--primary" href={mailto('Вопрос в поддержку Sunnet')}>
            <Mail size={18} aria-hidden /> Написать в поддержку
          </a>
          <Link className="help-btn" to={HELP_PATHS.contacts}>
            Как составить письмо
          </Link>
        </div>
        <p className="help-callout__mail">
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </>
  );
}

function Question({
  item,
  open,
  onToggle,
  words,
}: {
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
  words: string[];
}) {
  const btnId = `${item.id}-q`;
  const panelId = `${item.id}-a`;
  return (
    <div className="help-faq__item" id={item.id}>
      <h3 className="help-faq__q">
        <button
          type="button"
          id={btnId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span>
            <Highlight text={item.q} words={words} />
          </span>
          <ChevronDown className="help-faq__chev" size={20} aria-hidden />
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        className="help-faq__a help-prose"
        hidden={!open}
      >
        <Blocks blocks={item.a} />
        <CopyLink id={item.id} />
      </div>
    </div>
  );
}

/** «Скопировать ссылку» на ответ; без доступа к буферу — просто открывает якорь. */
function CopyLink({ id }: { id: string }) {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}${HELP_PATHS.faq}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch {
      navigate({ hash: id }, { replace: true });
    }
  };
  return (
    <p className="help-faq__tools">
      <button type="button" className="help-faq__copy" onClick={() => void copy()}>
        {done ? <Check size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
        <span aria-live="polite">
          {done ? 'Ссылка скопирована' : 'Скопировать ссылку на ответ'}
        </span>
      </button>
    </p>
  );
}
