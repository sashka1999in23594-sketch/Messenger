import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, Lock, Paperclip, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import { LIMITS, type ChatSummary, type MediaItem } from '@omni/shared';
import { uploadAny } from '../../shared/lib/media';
import { realtime } from '../../shared/realtime/socket';
import { usePrefs } from '../../shared/stores/prefs';
import { toast } from '../../shared/stores/ui';
import { errorMessage } from '../../shared/api/client';
import { useIsMobile } from '../../shared/hooks';
import { IconButton } from '../../shared/ui';
import type { LocalMessage } from './cache';

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
}

/** Черновики живут в памяти вкладки: переключение между чатами их не теряет. */
const drafts = new Map<string, string>();
const QUICK_EMOJI = ['😀', '😂', '😍', '🥰', '😎', '🤔', '😢', '😡', '👍', '👎', '🙏', '👏', '🔥', '🎉', '❤️', '💯', '✅', '🚀', '👀', '🤝'];

export function Composer({
  chat,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onSubmit,
  onSaveEdit,
  onEditLast,
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
  secret: boolean;
}) {
  const [text, setText] = useState(() => drafts.get(chat.id) ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);
  const enterToSend = usePrefs((s) => s.enterToSend);
  const isMobile = useIsMobile();

  useEffect(() => {
    setText(drafts.get(chat.id) ?? '');
    setAttachments([]);
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

  // Автовысота поля ввода
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

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
  const canSend = !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    if (editing) {
      onSaveEdit(editing.msg, text.trim());
      setText(drafts.get(chat.id) ?? '');
      return;
    }
    onSubmit({ text: text.trim(), mediaIds: ready.map((a) => a.media!.id), media: ready.map((a) => a.media!), replyTo });
    attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    setAttachments([]);
    setText('');
    drafts.delete(chat.id);
    input.current?.focus();
  };

  const onChange = (v: string) => {
    setText(v.slice(0, LIMITS.messageMax));
    const now = Date.now();
    if (v && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      realtime.send({ t: 'typing', chatId: chat.id });
    }
  };

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
        {emojiOpen && (
          <div className="card" style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                style={{ fontSize: 24, width: 40, height: 40, borderRadius: 10 }}
                onClick={() => {
                  onChange(text + e);
                  input.current?.focus();
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="composer__bar">
          <div className="composer__box">
            <IconButton label="Эмодзи" onClick={() => setEmojiOpen((v) => !v)} active={emojiOpen}>
              <Smile size={22} />
            </IconButton>
            <textarea
              ref={input}
              className="composer__input"
              rows={1}
              value={text}
              placeholder={secret ? 'Зашифрованное сообщение' : chat.type === 'channel' ? 'Публикация в канал' : 'Сообщение'}
              onChange={(e) => onChange(e.target.value)}
              onPaste={(e) => {
                if (!secret && e.clipboardData.files.length) {
                  e.preventDefault();
                  addFiles(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && enterToSend && !isMobile && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') {
                  if (editing) onCancelEdit();
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
              <IconButton label="Прикрепить файл" onClick={() => fileInput.current?.click()} disabled={!!editing}>
                <Paperclip size={22} />
              </IconButton>
            )}
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/*,video/*,audio/*,.pdf,.zip"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          <button className="composer__send" onClick={submit} disabled={!canSend} aria-label={editing ? 'Сохранить' : 'Отправить'}>
            {uploading ? <span className="spinner" /> : <SendHorizontal size={22} />}
          </button>
        </div>
      </div>
    </div>
  );
}
