/** Выбор даты и времени: быстрые варианты + точное время. */
import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { Button } from './Button';
import { Input } from './Field';
import { Modal } from './Modal';

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Быстрые варианты времени: через час, сегодня вечером, завтра утром. */
function presets(): { label: string; at: Date }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 3600_000);
  const evening = new Date(now);
  evening.setHours(21, 0, 0, 0);
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  return [
    { label: 'Через час', at: inHour },
    ...(evening.getTime() > now.getTime() + 600_000 ? [{ label: 'Сегодня в 21:00', at: evening }] : []),
    { label: 'Завтра в 9:00', at: morning },
  ];
}

export function ScheduleDialog({
  onClose,
  onSchedule,
  title = 'Отправить позже',
  hint = 'Сообщение уйдёт автоматически, даже если вы будете не в сети. Изменить или отправить сразу можно в списке отложенных.',
  initial,
}: {
  onClose: () => void;
  onSchedule: (at: Date) => Promise<void>;
  title?: string;
  hint?: string;
  initial?: Date;
}) {
  const [value, setValue] = useState(() => toLocalInput(initial ?? new Date(Date.now() + 3600_000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (at: Date) => {
    setBusy(true);
    setError(null);
    try {
      await onSchedule(at);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.sendAt ?? e.message) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={<CalendarClock size={18} />} loading={busy} onClick={() => void submit(new Date(value))}>
            Запланировать
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <div className="chips" style={{ flexWrap: 'wrap', maskImage: 'none' }}>
          {presets().map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setValue(toLocalInput(p.at))}>
              {p.label}
            </button>
          ))}
        </div>
        <Input label="Дата и время" type="datetime-local" value={value} min={toLocalInput(new Date())} onChange={(e) => setValue(e.target.value)} error={error} />
        <p className="small muted">{hint}</p>
      </div>
    </Modal>
  );
}

