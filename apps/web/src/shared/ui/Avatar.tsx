import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { SYSTEM_USER_ID } from '@omni/shared';
import { cn, hueFor, initials } from '../lib/format';
import { Logo } from './Brand';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  id?: string;
  size?: number;
  online?: boolean;
  /** Кольцо историй: непросмотренные, просмотренные, «для близких друзей» */
  ring?: 'unseen' | 'seen' | 'close' | null;
  className?: string;
}

export function Avatar({ src, name, id, size = 40, online, ring, className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const hue = hueFor(id ?? name);
  return (
    <span
      className={cn('avatar', ring && 'avatar--ring', ring === 'seen' && 'avatar--seen', ring === 'close' && 'avatar--close', className)}
      style={{ width: size, height: size }}
    >
      {id === SYSTEM_USER_ID ? (
        // Служебный аккаунт SpaceUp — всегда с логотипом
        <Logo size={size} />
      ) : src && !broken ? (
        <img className="avatar__img" src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} draggable={false} />
      ) : (
        <span
          className="avatar__fallback"
          style={{ fontSize: Math.max(11, size * 0.38), background: `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${(hue + 40) % 360} 70% 45%))` }}
          aria-hidden
        >
          {initials(name)}
        </span>
      )}
      {online && <span className="avatar__online" aria-label="в сети" />}
    </span>
  );
}

export function Verified({ size = 16 }: { size?: number }) {
  return <BadgeCheck className="verified" size={size} aria-label="Подтверждённый аккаунт" />;
}
