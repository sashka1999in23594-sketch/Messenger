import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, BellOff, CalendarClock, FileText, Image, Lock, Mic, Paperclip, Pencil, Reply, SendHorizontal, Smile, Trash2, Video, X } from 'lucide-react';
import { LIMITS, type ChatMember, type ChatSummary, type MediaItem, type PollInput } from '@omni/shared';
import { api, errorMessage, uploadFile } from '../../shared/api/client';
import { qk } from '../../shared/api/query';
import { uploadAny } from '../../shared/lib/media';
import { realtime } from '../../shared/realtime/socket';
import { usePrefs } from '../../shared/stores/prefs';
import { toast } from '../../shared/stores/ui';
import { useIsMobile } from '../../shared/hooks';
import { cn } from '../../shared/lib/format';
import { Avatar, EmojiPicker, IconButton, Menu, useMenu } from '../../shared/ui';
import type { LocalMessage } from './cache';
import { PollDialog, ScheduleDialog } from './extras';
import { fmtSec, useRecorder, waveformToBase64 } from './recorder';

interface Attachment {
  id: string;
  file: File;
  preview: string | null;
  progress: number;
  media: MediaItem | null;
  error: string | null;
}

export interface ComposerSubmit {
  text: string;
  mediaIds: string[];
  media: MediaItem[];
  replyTo: LocalMessage | null;
  kind?: 'voice' | 'round';
  silent?: boolean;
}

/** Черновики живут в памяти вкладки: переключение между чатами их не теряет. */
const drafts = new Map<string, string>();

/** «@ник» перед курсором — для подсказки упоминаний. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([a-z0-9_]{0,32})$/i.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() } : null;
}

/** Запись видео-кружка: круглое превью с прогрессом. */
function RoundRecorder({ chatId, onDone, onCancel }: { chatId: string; onDone: (media: MediaItem) => void; onCancel: () => void }) {
  const rec = useRecorder('round');
  const video = useRef<HTMLVideoElement>(null);
  const [uploading, setUploading] = useState(false);
  const started = useRef(false);

  const { start } = rec;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start().then((ok) => !ok && setTimeout(onCancel, 1800));
  }, [start, onCancel]);
  const { stream, capturePoster } = rec;
  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => undefined);
      const t = setTimeout(() => capturePoster(video.current), 600);
      return () => clearTimeout(t);
    }
  }, [stream, capturePoster]);
  useEffect(() => {
    if (rec.state !== 'recording') return;
    const t = setInterval(() => realtime.send({ t: 'typing', chatId, activity: 'round' }), 3000);
    realtime.send({ t: 'typing', chatId, activity: 'round' });
    return () => clearInterval(t);
  }, [rec.state, chatId]);

  const send = async () => {
    const r = await rec.stop();
    if (!r) return onCancel();
    setUploading(true);
    try {
      const poster = r.poster ? await uploadFile(r.poster, 'round.jpg', { width: 320, height: 320 }) : null;
      const media = await uploadFile(r.blob, `round.${r.ext}`, { duration: r.durationSec, width: 480, height: 480, posterId: poster?.id });
      onDone(media);
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
      onCancel();
    }
  };

  const R = 47;
  const C = 2 * Math.PI * R;
  const progress = Math.min(1, rec.elapsed / LIMITS.roundMaxSec);
  return (
    <div className="round-rec" role="dialog" aria-label="Запись видеосообщения">
      <div className="round-rec__circle">
        <video ref={video} muted playsInline />
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        {rec.error && <div className="round-rec__error">{rec.error}</div>}
      </div>
      <div className="round-rec__time">
        <span className="rec-dot" /> {fmtSec(rec.elapsed)} / {fmtSec(LIMITS.roundMaxSec)}
      </div>
      <div className="round-rec__actions">
        <button type="button" className="round-rec__btn" onClick={() => (rec.cancel(), onCancel())} aria-label="Отменить">
          <Trash2 size={22} />
        </button>
        <button type="button" className="round-rec__btn round-rec__btn--send" disabled={rec.state !== 'recording' || uploading} onClick={() => void send()} aria-label="Отправить">
          {uploading ? <span className="spinner" /> : <SendHorizontal size={24} />}
        </button>
      </div>
    </div>
  );
}

export function Composer({
  chat,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onSubmit,
  onSaveEdit,
  onEditLast,
  onPoll,
  onSchedule,
  secret,
}: {
  chat: ChatSummary;
  replyTo: LocalMessage | null;
  editing: { msg: LocalMessage; text: string } | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onSubmit: (data: ComposerSubmit) => void;
  onSaveEdit: (msg: LocalMessage, text: string) => void;
  /** ↑ в пустом поле — редактировать последнее своё сообщение */
  onEditLast: () => void;
  onPoll: (poll: PollInput) => Promise<void>;
  onSchedule: (data: ComposerSubmit, at: Date) => Promise<void>;
  secret: boolean;
}) {
  const spellcheck = usePrefs((s) => s.spellcheck ?? true);
  const [text, setText] = useState(() => drafts.get(chat.id) ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [scheduling, setScheduling] = useState<ComposerSubmit | null>(null);
  const [roundOpen, setRoundOpen] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachMenu = useMenu();
  const sendMenu = useMenu();
  const enterToSend = usePrefs((s) => s.enterToSend);
  const isMobile = useIsMobile();
  const voice = useRecorder('voice');
  const isGroup = chat.type === 'group';
  const canPoll = (chat.type === 'group' || chat.type === 'channel') && !secret;

  const membersQ = useQuery({
    queryKey: qk.members(chat.id),
    queryFn: () => api.get<{ items: ChatMember[] }>(`/chats/${chat.id}/members?limit=100`),
    enabled: isGroup,
    staleTime: 60_000,
  });

  useEffect(() => {
    setText(drafts.get(chat.id) ?? '');
    setAttachments([]);
    setEmojiOpen(false);
  }, [chat.id]);
  useEffect(() => {
    if (!editing) drafts.set(chat.id, text);
  }, [chat.id, text, editing]);
  useEffect(() => {
    if (editing) {
      setText(editing.text);
      input.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (voice.state !== 'recording') return;
    realtime.send({ t: 'typing', chatId: chat.id, activity: 'voice' });
    const t = setInterval(() => realtime.send({ t: 'typing', chatId: chat.id, activity: 'voice' }), 3000);
    return () => clearInterval(t);
  }, [voice.state, chat.id]);
  useEffect(() => {
    if (voice.error) toast({ text: voice.error, kind: 'error' });
  }, [voice.error]);

  // Автовысота поля ввода
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const mention = isGroup ? mentionAt(text, caret) : null;
  const suggestions = useMemo(() => {
    if (!mention) return [];
    return (membersQ.data?.items ?? [])
      .map((m) => m.user)
      .filter((u) => u.username.startsWith(mention.query) || u.displayName.toLowerCase().includes(mention.query))
      .slice(0, 6);
  }, [mention, membersQ.data]);
  useEffect(() => setMentionIdx(0), [mention?.query]);

  const insertMention = (username: string) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${username} ${text.slice(caret)}`;
    setText(next);
    const pos = mention.start + username.length + 2;
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
      input.current?.focus();
    });
  };

  const addFiles = (files: FileList | File[]) => {
    const list = [...files].slice(0, LIMITS.mediaPerMessage - attachments.length);
    for (const file of list) {
      const id = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;
      setAttachments((a) => [...a, { id, file, preview, progress: 0, media: null, error: null }]);
      uploadAny(file, { onProgress: (p) => setAttachments((a) => a.map((x) => (x.id === id ? { ...x, progress: p } : x))) })
        .then((media) => setAttachments((a) => a.map((x) => (x.id === id ? { ...x, media, progress: 1 } : x))))
        .catch((e: unknown) => {
          toast({ text: errorMessage(e), kind: 'error' });
          setAttachments((a) => a.map((x) => (x.id === id ? { ...x, error: errorMessage(e) } : x)));
        });
    }
  };

  const uploading = attachments.some((a) => !a.media && !a.error);
  const ready = attachments.filter((a) => a.media);
  const hasContent = text.trim().length > 0 || ready.length > 0;
  const canSend = !uploading && hasContent;
  const showMic = !hasContent && !uploading && !editing && !secret && attachments.length === 0;

  const collect = (): ComposerSubmit => ({ text: text.trim(), mediaIds: ready.map((a) => a.media!.id), media: ready.map((a) => a.media!), replyTo });
  const reset = () => {
    attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    setAttachments([]);
    setText('');
    drafts.delete(chat.id);
    setEmojiOpen(false);
    input.current?.focus();
  };

  const submit = (silent = false) => {
    if (!canSend) return;
    if (editing) {
      onSaveEdit(editing.msg, text.trim());
      setText(drafts.get(chat.id) ?? '');
      return;
    }
    onSubmit({ ...collect(), silent });
    reset();
  };

  const sendVoice = async () => {
    const r = await voice.stop();
    if (!r) return;
    setVoiceBusy(true);
    try {
      const media = await uploadFile(r.blob, `voice.${r.ext}`, { as: 'audio', duration: r.durationSec, waveform: waveformToBase64(r.waveform) });
      onSubmit({ text: '', mediaIds: [media.id], media: [media], replyTo, kind: 'voice' });
    } catch (e) {
      toast({ text: errorMessage(e), kind: 'error' });
    } finally {
      setVoiceBusy(false);
    }
  };

  const onChange = (v: string, pos: number) => {
    setText(v.slice(0, LIMITS.messageMax));
    setCaret(pos);
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      realtime.send({ t: 'typing', chatId: chat.id });
    }
  };

  const openSendMenu = (x: number, y: number) => {
    if (!canSend || editing) return;
    sendMenu.openAt(x, y);
  };

  const recording = voice.state !== 'idle';

  return (
    <div
      className="composer"
      onDragOver={(e) => {
        if (!secret) e.preventDefault();
      }}
      onDrop={(e) => {
        if (secret) return;
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <div className="composer__inner">
        {(replyTo || editing) && (
          <div className="composer__context">
            {editing ? <Pencil size={18} className="faint" /> : <Reply size={18} className="faint" />}
            <div className="col grow" style={{ gap: 0 }}>
              <span className="bold" style={{ color: 'var(--accent-fg)' }}>
                {editing ? 'Редактирование' : `Ответ ${replyTo!.sender?.displayName ?? ''}`}
              </span>
              <span className="ellipsis muted">{editing ? editing.text : replyTo!.kind === 'encrypted' ? '🔒 Зашифрованное сообщение' : replyTo!.text || 'Вложение'}</span>
            </div>
            <IconButton label="Отменить" size="sm" onClick={editing ? onCancelEdit : onCancelReply}>
              <X size={18} />
            </IconButton>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer__attachments">
            {attachments.map((a) => (
              <div key={a.id} className="attachment" title={a.file.name}>
                {a.preview && a.file.type.startsWith('image/') ? (
                  <img src={a.preview} alt="" />
                ) : a.preview ? (
                  <video src={a.preview} muted />
                ) : (
                  <FileText size={28} />
                )}
                {!a.media && !a.error && (
                  <div className="progress attachment__progress">
                    <div className="progress__bar" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                  </div>
                )}
                <button
                  className="attachment__remove"
                  aria-label="Убрать"
                  onClick={() => {
                    if (a.preview) URL.revokeObjectURL(a.preview);
                    setAttachments((list) => list.filter((x) => x.id !== a.id));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="mention-list" role="listbox" aria-label="Упомянуть">
            {suggestions.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === mentionIdx}
                className="mention-list__item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u.username);
                }}
              >
                <Avatar src={u.avatarUrl} name={u.displayName} id={u.id} size={30} />
                <span className="bold ellipsis">{u.displayName}</span>
                <span className="small muted">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {emojiOpen && (
          <EmojiPicker
            onClose={() => setEmojiOpen(false)}
            onPick={(e) => {
              const el = input.current;
              const pos = el?.selectionStart ?? text.length;
              const next = text.slice(0, pos) + e + text.slice(pos);
              onChange(next, pos + e.length);
              requestAnimationFrame(() => {
                el?.setSelectionRange(pos + e.length, pos + e.length);
                if (!isMobile) el?.focus();
              });
            }}
          />
        )}
        {recording ? (
          <div className="composer__bar">
            <div className="composer__box voice-rec">
              <IconButton label="Удалить запись" danger onClick={() => voice.cancel()}>
                <Trash2 size={20} />
              </IconButton>
              <span className="rec-dot" />
              <span className="voice-rec__time">{fmtSec(voice.elapsed)}</span>
              <span className="voice-rec__wave" aria-hidden>
                {voice.levels.map((l, i) => (
                  <span key={i} style={{ height: `${10 + l * 90}%` }} />
                ))}
              </span>
            </div>
            <button className="composer__send" onClick={() => void sendVoice()} aria-label="Отправить голосовое" disabled={voice.state !== 'recording'}>
              <SendHorizontal size={22} />
            </button>
          </div>
        ) : (
          <div className="composer__bar">
            <div className="composer__box">
              <IconButton label="Эмодзи" onClick={() => setEmojiOpen((v) => !v)} active={emojiOpen}>
                <Smile size={22} />
              </IconButton>
              <textarea
                ref={input}
                className="composer__input"
                rows={1}
                spellCheck={spellcheck}
                value={text}
                placeholder={secret ? 'Зашифрованное сообщение' : chat.type === 'channel' ? 'Публикация в канал' : 'Сообщение'}
                onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onPaste={(e) => {
                  if (!secret && e.clipboardData.files.length) {
                    e.preventDefault();
                    addFiles(e.clipboardData.files);
                  }
                }}
                onKeyDown={(e) => {
                  if (suggestions.length) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      setMentionIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      insertMention(suggestions[mentionIdx]!.username);
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && enterToSend && !isMobile && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                  if (e.key === 'Escape') {
                    if (emojiOpen) setEmojiOpen(false);
                    else if (editing) onCancelEdit();
                    else if (replyTo) onCancelReply();
                  }
                  if (e.key === 'ArrowUp' && !text && !editing) {
                    e.preventDefault();
                    onEditLast();
                  }
                }}
                aria-label="Текст сообщения"
                maxLength={LIMITS.messageMax}
              />
              {secret ? (
                <span className="icon-btn" title="Вложения в секретных чатах появятся вместе с шифрованием файлов" style={{ color: 'var(--success)' }}>
                  <Lock size={20} />
                </span>
              ) : (
                <>
                  <IconButton label="Прикрепить" onClick={(e) => attachMenu.openFromEvent(e)} disabled={!!editing}>
                    <Paperclip size={22} />
                  </IconButton>
                  {showMic && (
                    <IconButton label="Видеосообщение (кружок)" onClick={() => setRoundOpen(true)}>
                      <Video size={22} />
                    </IconButton>
                  )}
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {showMic ? (
              <button className="composer__send composer__send--mic" onClick={() => void voice.start()} aria-label="Записать голосовое" title="Записать голосовое" disabled={voiceBusy}>
                {voiceBusy ? <span className="spinner" /> : <Mic size={22} />}
              </button>
            ) : (
              <button
                className="composer__send"
                onClick={() => submit()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openSendMenu(e.clientX, e.clientY);
                }}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  longPress.current = setTimeout(() => t && openSendMenu(t.clientX, t.clientY - 100), 500);
                }}
                onTouchEnd={() => longPress.current && clearTimeout(longPress.current)}
                disabled={!canSend}
                aria-label={editing ? 'Сохранить' : 'Отправить (правая кнопка — больше вариантов)'}
              >
                {uploading ? <span className="spinner" /> : <SendHorizontal size={22} />}
              </button>
            )}
          </div>
        )}
      </div>

      <Menu
        anchor={attachMenu.anchor}
        onClose={attachMenu.close}
        items={[
          {
            label: 'Фото или видео',
            icon: <Image size={18} />,
            onClick: () => {
              if (fileInput.current) {
                fileInput.current.accept = 'image/*,video/*';
                fileInput.current.click();
              }
            },
          },
          {
            label: 'Файл',
            icon: <FileText size={18} />,
            onClick: () => {
              if (fileInput.current) {
                fileInput.current.accept = 'image/*,video/*,audio/*,.pdf,.zip';
                fileInput.current.click();
              }
            },
          },
          { label: 'Опрос', icon: <BarChart3 size={18} />, hidden: !canPoll, onClick: () => setPollOpen(true) },
          { label: 'Видеосообщение', icon: <Video size={18} />, onClick: () => setRoundOpen(true) },
        ]}
      />
      <Menu
        anchor={sendMenu.anchor}
        onClose={sendMenu.close}
        items={[
          { label: 'Отправить без звука', icon: <BellOff size={18} />, onClick: () => submit(true) },
          { label: 'Отправить позже…', icon: <CalendarClock size={18} />, hidden: secret, onClick: () => setScheduling(collect()) },
        ]}
      />
      {pollOpen && <PollDialog onClose={() => setPollOpen(false)} onCreate={onPoll} />}
      {scheduling && (
        <ScheduleDialog
          onClose={() => setScheduling(null)}
          onSchedule={async (at) => {
            await onSchedule(scheduling, at);
            reset();
          }}
        />
      )}
      {roundOpen && (
        <RoundRecorder
          chatId={chat.id}
          onCancel={() => setRoundOpen(false)}
          onDone={(media) => {
            setRoundOpen(false);
            onSubmit({ text: '', mediaIds: [media.id], media: [media], replyTo, kind: 'round' });
          }}
        />
      )}
    </div>
  );
}
