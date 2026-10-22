import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { passwordStrength } from '@omni/shared';
import { cn } from '../lib/format';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      {children(id)}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, className, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <input ref={ref} id={id} className={cn('input', error && 'input--error', className)} aria-invalid={!!error || undefined} {...rest} />}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, className, ...rest }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <textarea ref={ref} id={id} className={cn('textarea', error && 'input--error', className)} {...rest} />}
    </Field>
  );
});

export function PasswordInput({ showStrength, ...props }: InputProps & { showStrength?: boolean }) {
  const [visible, setVisible] = useState(false);
  const score = showStrength ? passwordStrength(String(props.value ?? '')) : 0;
  const labels = ['', 'Слабый', 'Средний', 'Надёжный', 'Очень надёжный'];
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {(id) => (
        <>
          <div className="input-group">
            <input
              {...props}
              id={id}
              type={visible ? 'text' : 'password'}
              className={cn('input', props.error && 'input--error')}
              style={{ paddingLeft: 14, paddingRight: 48 }}
              autoCapitalize="none"
              spellCheck={false}
            />
            <button
              type="button"
              className="icon-btn icon-btn--sm input-group__action"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
              style={{ right: 6 }}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {showStrength && String(props.value ?? '').length > 0 && (
            <div className="row" style={{ gap: 10 }}>
              <div className="strength grow" data-score={score}>
                <span />
                <span />
                <span />
                <span />
              </div>
              <span className="xs muted" style={{ minWidth: 96, textAlign: 'right' }}>
                {labels[score]}
              </span>
            </div>
          )}
        </>
      )}
    </Field>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

/** Строка настройки: заголовок, описание и элемент управления справа. */
export function SettingRow({
  title,
  description,
  control,
  icon,
  tile,
  onClick,
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  icon?: ReactNode;
  /** Цвет плитки иконки: tile-blue, tile-red… */
  tile?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="list-item" onClick={onClick} type={onClick ? 'button' : undefined}>
      {icon && <span className={cn('list-item__icon', tile)}>{icon}</span>}
      <span className="list-item__body">
        <span className="list-item__title" style={{ display: 'block' }}>
          {title}
        </span>
        {description && <span className="list-item__sub">{description}</span>}
      </span>
      {control && <span className="list-item__end">{control}</span>}
      {onClick && !control && <ChevronRight size={18} className="list-item__chevron" aria-hidden />}
    </Tag>
  );
}

/**
 * Поле для 6-значного кода: шесть ячеек, автозаполнение из SMS/письма (one-time-code),
 * вставка из буфера. Под капотом — одно обычное поле, поэтому работает с экранными дикторами.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  error,
  autoFocus,
  label = 'Код подтверждения',
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  error?: string | null;
  autoFocus?: boolean;
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, '').slice(0, length);
  return (
    <div className="field">
      <div className={cn('otp', error && 'otp--error', focused && 'otp--focus')}>
        <input
          className="otp__input"
          value={digits}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={label}
          aria-invalid={!!error || undefined}
          maxLength={length}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, length);
            onChange(v);
            if (v.length === length) onComplete?.(v);
          }}
        />
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cn('otp__cell', digits[i] && 'otp__cell--filled', focused && i === Math.min(digits.length, length - 1) && 'otp__cell--active')} aria-hidden>
            {digits[i] ?? ''}
          </span>
        ))}
      </div>
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
