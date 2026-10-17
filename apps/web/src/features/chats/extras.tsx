/** Окна мессенджера: опрос, отложенная отправка, список отложенных, «кто прочитал». */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus, Send, Trash2, X } from 'lucide-react';
import { LIMITS, type Message, type PollInput, type ScheduledMessage, type UserSummary } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { queryClient } from '../../shared/api/query';
import { toast } from '../../shared/stores/ui';
import { fullDate } from '../../shared/lib/format';
import { Button, EmptyState, Input, ListSkeleton, Modal, SettingRow, Switch, UserRow } from '../../shared/ui';
import { upsertMessage } from './cache';

export const scheduledKey = (chatId: string) => ['scheduled', chatId] as const;

/** Выбор времени — общий компонент */
export { ScheduleDialog } from '../../shared/ui';

export function PollDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (poll: PollInput) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim() && filled.length >= 2;

  const submit = async () => {
    setBusy(true);
    try {
      const idx = options.slice(0, correct + 1).filter((o) => o.trim()).length - 1;
      await onCreate({ question: question.trim(), options: filled, anonymous, multiple: quiz ? false : multiple, correctOption: quiz ? Math.max(0, idx) : undefined });
      onClose();
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Новый опрос"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void submit()}>
            Создать
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Input label="Вопрос" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={LIMITS.pollQuestionMax} autoFocus placeholder="Куда поедем в выходные?" />
        <div className="field">
          <span className="field__label">Варианты ответа</span>
          <div className="col gap-2">
            {options.map((o, i) => (
              <div key={i} className="row poll-edit__row">
                {quiz && (
                  <input type="radio" name="correct" checked={correct === i} onChange={() => setCorrect(i)} aria-label="Верный ответ" title="Верный ответ" />
                )}
                <input
                  className="input"
                  value={o}
                  maxLength={LIMITS.pollOptionMax}
                  placeholder={`Вариант ${i + 1}`}
                  onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {options.length > 2 && (
                  <button type="button" className="icon-btn icon-btn--sm" aria-label="Убрать вариант" onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {options.length < LIMITS.pollOptionsMax && (
              <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={() => setOptions((l) => [...l, ''])} style={{ alignSelf: 'flex-start' }}>
                Добавить вариант
              </Button>
            )}
          </div>
        </div>
        <div className="card">
          <SettingRow title="Анонимное голосование" description="Никто не увидит, кто как ответил" control={<Switch checked={anonymous} onChange={setAnonymous} label="Анонимно" />} />
          <SettingRow title="Несколько ответов" control={<Switch checked={multiple && !quiz} onChange={setMultiple} disabled={quiz} label="Несколько ответов" />} />
          <SettingRow title="Викторина" description="Один верный ответ — отметьте его кружком" control={<Switch checked={quiz} onChange={setQuiz} label="Викторина" />} />
        </div>
      </div>
    </Modal>
  );
}

export function ScheduledListDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: scheduledKey(chatId), queryFn: () => api.get<{ items: ScheduledMessage[] }>(`/chats/${chatId}/scheduled`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scheduledKey(chatId) });
  const sendNow = useMutation({
    mutationFn: (id: string) => api.post<Message>(`/chats/${chatId}/scheduled/${id}/send`),
    onSuccess: (m) => {
      upsertMessage(chatId, m);
      refresh();
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/chats/${chatId}/scheduled/${id}`),
    onSuccess: refresh,
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const items = q.data?.items ?? [];
  return (
    <Modal open onClose={onClose} title="Отложенные сообщения">
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarClock size={28} />} title="Нет отложенных" text="Удерживайте кнопку отправки или нажмите правой кнопкой, чтобы запланировать сообщение." />
      ) : (
        <div className="col gap-2">
          {items.map((m) => (
            <div key={m.id} className="scheduled-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="xs faint">
                  <CalendarClock size={12} style={{ verticalAlign: -1 }} /> {fullDate(m.sendAt)}
                  {m.silent && ' · без звука'}
                </div>
                <div className="clamp-2">{m.text || `📎 Вложений: ${m.media.length}`}</div>
              </div>
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => sendNow.mutate(m.id)} aria-label="Отправить сейчас" title="Отправить сейчас">
                <Send size={16} />
              </button>
              <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" onClick={() => remove.mutate(m.id)} aria-label="Удалить" title="Удалить">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ReadersDialog({ chatId, messageId, onClose }: { chatId: string; messageId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['readers', messageId], queryFn: () => api.get<{ items: UserSummary[] }>(`/chats/${chatId}/messages/${messageId}/readers`) });
  return (
    <Modal open onClose={onClose} title="Прочитали">
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.data?.items.length ? (
        <div className="card">
          {q.data.items.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </div>
      ) : (
        <p className="muted">Пока никто не прочитал (или участники скрыли отчёты о прочтении).</p>
      )}
    </Modal>
  );
}
