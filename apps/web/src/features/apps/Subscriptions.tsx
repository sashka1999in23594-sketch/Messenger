/**
 * Подписки: сколько в месяц, что и когда спишется, ссылка на управление у сервиса.
 * Sunnet ничего не списывает сам и не видит ваши карты — только то, что вы указали.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../shared/api/client';
import { toast } from '../../shared/stores/ui';
import './apps.css';

interface Sub {
  id: string;
  name: string;
  price: number;
  currency: 'RUB' | 'USD' | 'EUR';
  period: 'week' | 'month' | 'year';
  nextPayment: string;
  manageUrl: string | null;
}
const PERIOD = { week: 'в неделю', month: 'в месяц', year: 'в год' } as const;
const CUR = { RUB: '₽', USD: '$', EUR: '€' } as const;
const daysTo = (d: string) => Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);

export function SubscriptionsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get<{ items: Sub[]; monthlyRub: number }>('/subscriptions') });
  const [form, setForm] = useState({ name: '', price: '', period: 'month' as Sub['period'], nextPayment: new Date().toISOString().slice(0, 10), manageUrl: '' });
  const [open, setOpen] = useState(false);
  const items = q.data?.items ?? [];
  const soon = items.filter((s) => daysTo(s.nextPayment) <= 2);

  // Напоминание о близком списании — один раз за открытие
  useEffect(() => {
    for (const s of soon) toast(`Скоро списание: ${s.name} — ${s.price} ${CUR[s.currency]} ${daysTo(s.nextPayment) <= 0 ? 'сегодня' : `через ${daysTo(s.nextPayment)} дн.`}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const add = async () => {
    try {
      await api.post('/subscriptions', { name: form.name, price: Number(form.price.replace(',', '.')), period: form.period, nextPayment: form.nextPayment, manageUrl: form.manageUrl.trim() || null });
      setOpen(false);
      setForm({ ...form, name: '', price: '', manageUrl: '' });
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    }
  };

  return (
    <div className="scroll apps">
      <header className="subs-head">
        <div>
          <h1>Подписки</h1>
          <p className="apps-note" style={{ marginTop: 4 }}>
            Sunnet не списывает деньги и не видит ваши карты — только то, что вы указали.
          </p>
        </div>
        <button type="button" className="apps-row__open" onClick={() => setOpen((o) => !o)}>
          <Plus size={15} /> Добавить
        </button>
      </header>
      <div className="subs-stats">
        <div>
          <span>В месяц</span>
          <b>{(q.data?.monthlyRub ?? 0).toLocaleString('ru')} ₽</b>
        </div>
        <div>
          <span>Ближайшее списание</span>
          <b>{items[0] ? `${new Date(items[0].nextPayment).toLocaleDateString('ru', { day: 'numeric', month: 'long' })} · ${items[0].name}` : '—'}</b>
        </div>
        <div>
          <span>Активных</span>
          <b>{items.length}</b>
        </div>
      </div>
      {open && (
        <form
          className="subs-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input required placeholder="Сервис, например Wink" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Сервис" />
          <input required inputMode="decimal" placeholder="Цена" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} aria-label="Цена" />
          <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as Sub['period'] })} aria-label="Период">
            <option value="month">в месяц</option>
            <option value="year">в год</option>
            <option value="week">в неделю</option>
          </select>
          <input type="date" value={form.nextPayment} onChange={(e) => setForm({ ...form, nextPayment: e.target.value })} aria-label="Следующий платёж" />
          <input placeholder="Ссылка «Управление подпиской» (https://…)" value={form.manageUrl} onChange={(e) => setForm({ ...form, manageUrl: e.target.value })} aria-label="Ссылка на управление" />
          <button type="submit" className="apps-row__open">
            Сохранить
          </button>
        </form>
      )}
      <ul className="apps-grid subs-list">
        {items.map((s, i) => {
          const d = daysTo(s.nextPayment);
          return (
            <li key={s.id} className="apps-row" style={{ '--i': i } as React.CSSProperties}>
              <span className="apps-row__icon" style={{ '--c1': '#ffd257', '--c2': '#ff9d2e' } as React.CSSProperties} aria-hidden>
                <CalendarClock size={22} />
              </span>
              <span className="apps-row__text">
                <span className="apps-row__name">{s.name}</span>
                <span className="apps-row__desc">
                  {s.price.toLocaleString('ru')} {CUR[s.currency]} {PERIOD[s.period]}
                </span>
                <span className={`apps-row__how${d <= 2 ? ' subs-soon' : ''}`}>{d <= 0 ? 'Списание сегодня' : `Следующий платёж через ${d} дн. · ${new Date(s.nextPayment).toLocaleDateString('ru')}`}</span>
              </span>
              {s.manageUrl && (
                <a className="apps-row__open" href={s.manageUrl} target="_blank" rel="noopener noreferrer">
                  Управлять <ExternalLink size={13} />
                </a>
              )}
              <button
                type="button"
                className="apps-row__add"
                aria-label={`Удалить ${s.name}`}
                onClick={async () => {
                  await api.del(`/subscriptions/${s.id}`);
                  await qc.invalidateQueries({ queryKey: ['subscriptions'] });
                }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
      {!items.length && !q.isLoading && <p className="apps-empty">Подписок пока нет. Добавьте их — Sunnet напомнит о списании за два дня.</p>}
    </div>
  );
}
