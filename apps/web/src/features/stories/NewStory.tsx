/**
 * Новая история: фото/видео с подписью или текстовая история на градиенте.
 * Текстовая рисуется в canvas 1080×1920 и загружается как обычная картинка.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AlignCenter, AlignLeft, Image as ImageIcon, Star, Type, Users } from 'lucide-react';
import { LIMITS, type Story } from '@omni/shared';
import { api, errorMessage } from '../../shared/api/client';
import { uploadAny } from '../../shared/lib/media';
import { useMe } from '../../shared/stores/session';
import { toast } from '../../shared/stores/ui';
import { cn } from '../../shared/lib/format';
import { Button, Input, Segmented, SettingRow, Switch, Textarea } from '../../shared/ui';
import { LargeTitle } from '../misc/kit';
import { refreshStories } from './api';
import './stories.css';

const BACKGROUNDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const FONTS = [
  { id: 'classic', label: 'Классика', css: 'var(--font-sans)', canvas: 'Inter Variable', weight: 700 },
  { id: 'display', label: 'Заголовок', css: 'var(--font-display)', canvas: 'Unbounded Variable', weight: 600 },
  { id: 'mono', label: 'Моно', css: 'var(--font-mono)', canvas: 'monospace', weight: 600 },
  { id: 'neon', label: 'Неон', css: 'var(--font-sans)', canvas: 'Inter Variable', weight: 800 },
] as const;
type FontId = (typeof FONTS)[number]['id'];

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Перенос строк по ширине (и по явным переводам строки) */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

async function renderTextStory(opts: { text: string; bg: number; font: FontId; size: number; align: 'center' | 'left' }): Promise<File> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, cssVar(`--sg-${opts.bg}a`));
  grad.addColorStop(1, cssVar(`--sg-${opts.bg}b`));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const font = FONTS.find((f) => f.id === opts.font)!;
  const px = Math.round(opts.size * 3.375); // размер превью (320px) → 1080px
  const family = `${font.weight} ${px}px "${font.canvas}", system-ui, sans-serif`;
  await document.fonts.load(family).catch(() => undefined);
  ctx.font = family;
  ctx.fillStyle = cssVar(`--sg-${opts.bg}t`);
  ctx.textAlign = opts.align;
  ctx.textBaseline = 'middle';
  if (font.id === 'neon') {
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 40;
  }
  const pad = 108;
  const lines = wrap(ctx, opts.text, W - pad * 2);
  const lh = px * 1.2;
  const top = H / 2 - ((lines.length - 1) * lh) / 2;
  const x = opts.align === 'center' ? W / 2 : pad;
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/jpeg', 0.92));
  return new File([blob], 'story.jpg', { type: 'image/jpeg' });
}

export function NewStoryPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [mode, setMode] = useState<'media' | 'text'>('media');
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const [caption, setCaption] = useState('');
  const [text, setText] = useState('');
  const [bg, setBg] = useState<number>(1);
  const [font, setFont] = useState<FontId>('classic');
  const [size, setSize] = useState(30);
  const [align, setAlign] = useState<'center' | 'left'>('center');
  const [audience, setAudience] = useState<'all' | 'close'>('all');
  const [allowReplies, setAllowReplies] = useState(true);
  const [progress, setProgress] = useState(0);
  const fontDef = FONTS.find((f) => f.id === font)!;

  const publish = useMutation({
    mutationFn: async () => {
      const source = mode === 'text' ? await renderTextStory({ text: text.trim(), bg, font, size, align }) : file!;
      const media = await uploadAny(source, { onProgress: setProgress });
      return api.post<Story>('/stories', { mediaId: media.id, text: mode === 'media' ? caption.trim() || undefined : undefined, audience, allowReplies });
    },
    onSuccess: () => {
      toast({ text: audience === 'close' ? 'История для близких друзей опубликована' : 'История опубликована на 24 часа', kind: 'success' });
      refreshStories(me.id);
      navigate(-1);
    },
    onError: (e) => toast({ text: errorMessage(e), kind: 'error' }),
  });
  const ready = mode === 'text' ? !!text.trim() : !!file;

  return (
    <div className="pk-root">
    <div className="scroll">
      <div className="page story-new">
        <LargeTitle title="Новая история" sub="Исчезнет через 24 часа и останется в вашем архиве" />
        <div className="story-new__mode">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'media', label: 'Фото или видео' },
              { value: 'text', label: 'Текст' },
            ]}
          />
        </div>
        <div className="story-editor">
          <div className="story-canvas" style={mode === 'text' ? { background: `linear-gradient(135deg, var(--sg-${bg}a), var(--sg-${bg}b))` } : undefined}>
            {mode === 'media' ? (
              file && preview ? (
                file.type.startsWith('video/') ? (
                  <video src={preview} autoPlay muted loop playsInline />
                ) : (
                  <img src={preview} alt="" />
                )
              ) : (
                <label className="col center gap-2" style={{ cursor: 'pointer', color: 'var(--story-fg-2)', textAlign: 'center', padding: 24 }}>
                  <ImageIcon size={40} />
                  <b style={{ color: 'var(--story-fg)' }}>Выберите фото или видео</b>
                  <span className="small">Вертикальные 9:16 смотрятся лучше всего</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFile(f);
                    }}
                  />
                </label>
              )
            ) : (
              <div
                className="story-canvas__text"
                style={{
                  justifyContent: align === 'center' ? 'center' : 'flex-start',
                  textAlign: align,
                  fontFamily: fontDef.css,
                  fontWeight: fontDef.weight,
                  fontSize: `${(size / 320) * 100}cqw`,
                  color: `var(--sg-${bg}t)`,
                  textShadow: font === 'neon' ? `0 0 12px var(--sg-${bg}t)` : undefined,
                }}
              >
                {text || 'Напишите что-нибудь…'}
              </div>
            )}
            {mode === 'media' && caption && <div className="story-canvas__caption">{caption}</div>}
            {audience === 'close' && (
              <span className="story-canvas__audience story-viewer__badge">
                <Star size={11} fill="currentColor" /> Близкие друзья
              </span>
            )}
          </div>

          <div className="col gap-4" style={{ width: '100%', minWidth: 0 }}>
            {mode === 'media' ? (
              <>
                {file && (
                  <label className="btn btn--secondary btn--sm" style={{ alignSelf: 'flex-start' }}>
                    <ImageIcon size={16} /> Другой файл
                    <input type="file" accept="image/*,video/*" hidden onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
                  </label>
                )}
                <Input label="Подпись поверх истории" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={LIMITS.storyTextMax} placeholder="Необязательно" />
              </>
            ) : (
              <>
                <Textarea label="Текст" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} rows={3} placeholder="О чём думаете?" autoFocus />
                <div className="field">
                  <span className="field__label">Фон</span>
                  <div className="story-bg-grid">
                    {BACKGROUNDS.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={cn('story-bg', bg === b && 'story-bg--active')}
                        style={{ background: `linear-gradient(135deg, var(--sg-${b}a), var(--sg-${b}b))` }}
                        onClick={() => setBg(b)}
                        aria-label={`Фон ${b}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field__label">Шрифт</span>
                  <div className="row wrap gap-2">
                    {FONTS.map((f) => (
                      <button key={f.id} type="button" className={cn('chip', font === f.id && 'chip--active')} style={{ fontFamily: f.css }} onClick={() => setFont(f.id)}>
                        <Type size={14} /> {f.label}
                      </button>
                    ))}
                    <button type="button" className={cn('chip', align === 'center' && 'chip--active')} onClick={() => setAlign('center')} aria-label="По центру">
                      <AlignCenter size={14} />
                    </button>
                    <button type="button" className={cn('chip', align === 'left' && 'chip--active')} onClick={() => setAlign('left')} aria-label="По левому краю">
                      <AlignLeft size={14} />
                    </button>
                  </div>
                </div>
                <label className="field">
                  <span className="field__label">Размер текста</span>
                  <input type="range" min={18} max={56} value={size} onChange={(e) => setSize(Number(e.target.value))} />
                </label>
              </>
            )}

            <div className="field">
              <span className="field__label">Кто увидит</span>
              <div className="story-audience">
                <button type="button" className={cn('story-audience__opt', audience === 'all' && 'story-audience__opt--on')} onClick={() => setAudience('all')}>
                  <span className="story-audience__dot">
                    <Users size={16} />
                  </span>
                  <span>
                    <b>Подписчики</b>
                    <span className="xs muted" style={{ display: 'block' }}>
                      Все, кто на вас подписан
                    </span>
                  </span>
                </button>
                <button type="button" className={cn('story-audience__opt story-audience__opt--close', audience === 'close' && 'story-audience__opt--on')} onClick={() => setAudience('close')}>
                  <span className="story-audience__dot">
                    <Star size={16} fill="currentColor" />
                  </span>
                  <span>
                    <b>Близкие друзья</b>
                    <span className="xs muted" style={{ display: 'block' }}>
                      Только ваш список
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <div className="card">
              <SettingRow title="Разрешить ответы" description="Ответы приходят вам в личные сообщения" control={<Switch checked={allowReplies} onChange={setAllowReplies} label="Разрешить ответы" />} />
              <SettingRow title="Список близких друзей" description="Кого добавить или убрать" onClick={() => navigate('/settings/privacy/close-friends')} />
            </div>
            {publish.isPending && (
              <div className="progress">
                <div className="progress__bar" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <div className="story-new__publish">
              <Button size="lg" block disabled={!ready} loading={publish.isPending} onClick={() => publish.mutate()}>
                Опубликовать
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
