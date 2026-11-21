/**
 * Подписки: человек сам записывает свои подписки (у большинства сервисов нет
 * открытого API со сведениями о платежах), Sunnet считает траты и напоминает
 * о списаниях. Управление — ссылкой на страницу подписки самого сервиса.
 */
import { useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { CATALOG, catalogById } from './catalog';
import { AppGlyph } from './AppGlyph';

interface Sub {
  id: string;
  appId: string;
  price: number;
  period: 'month' | 'year';
  next: string;
}

export const useSubs = create<{ subs: Sub[]; add: (s: Omit<Sub, 'id'>) => void; remove: (id: string) => void }>()(
  persist(
    (set, get) => ({
      subs: [],
      add: (s) => set({ subs: [...get().subs, { ...s, id: Math.random().toString(36).slice(2, 9) }] }),
      remove: (id) => set({ subs: get().subs.filter((s) => s.id !== id) }),
    }),
    { name: 'sunnet.subs' },
  ),
);

const PAID = CATALOG.filter((a) => ['music', 'video', 'ai', 'work', 'docs'].includes(a.cat));

export function Subscriptions() {
  const { subs, add, remove } = useSubs();
  const [appId, setAppId] = useState(PAID[0]!.id);
  const [price, setPrice] = useState('299');
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [next, setNext] = useState(new Date(Date.now() + 14 * 86400e3).toISOString().slice(0, 10));
  const monthly = subs.reduce((s, x) => s + (x.period === 'month' ? x.price : x.price / 12), 0);
  const days = (d: string) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400e3);

  return (
    <div className="subs">
      <div className="subs__total">
        <div>
          <div className="subs__big">{Math.round(monthly).toLocaleString('ru')} ₽</div>
          <div className="subs__muted">в месяц на {subs.length} подписок · {Math.round(monthly * 12).toLocaleString('ru')} ₽ в год</div>
        </div>
      </div>
      <div className="subs__list">
        {subs.map((s) => {
          const app = catalogById.get(s.appId);
          if (!app) return null;
          const d = days(s.next);
          return (
            <div key={s.id} className="subs__row">
              <AppGlyph app={app} size={40} />
              <div className="subs__text">
                <b>{app.name}</b>
                <span className="subs__muted">
                  {s.price} ₽ / {s.period === 'month' ? 'мес' : 'год'} · списание {new Date(s.next).toLocaleDateString('ru')}
                </span>
              </div>
              <span className={d <= 3 ? 'tag tag--warning' : 'tag'}>{d > 0 ? `через ${d} дн.` : 'сегодня'}</span>
              <a className="icon-btn icon-btn--sm" href={app.url} target="_blank" rel="noopener noreferrer" title="Управлять на сайте сервиса">
                <ExternalLink size={15} />
              </a>
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => remove(s.id)} aria-label="Убрать">
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
        {!subs.length && <div className="subs__muted">Пока пусто. Добавьте подписки — Sunnet напомнит о списании за 3 дня.</div>}
      </div>
      <div className="subs__add">
        <select className="select" value={appId} onChange={(e) => setAppId(e.target.value)}>
          {PAID.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Цена" />
        <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as 'month' | 'year')}>
          <option value="month">в месяц</option>
          <option value="year">в год</option>
        </select>
        <input className="input" type="date" value={next} onChange={(e) => setNext(e.target.value)} aria-label="Следующее списание" />
        <button type="button" className="btn btn--primary" onClick={() => add({ appId, price: Number(price) || 0, period, next })}>
          <Plus size={16} /> Добавить
        </button>
      </div>
    </div>
  );
}
