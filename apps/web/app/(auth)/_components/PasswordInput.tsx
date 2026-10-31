'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/lib/components';

/**
 * Password field with a 44 px show/hide toggle (auth-24). No bullet
 * placeholder — "••••" reads as an already-filled password.
 */
export function PasswordInput({
  showLabel,
  hideLabel,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof Input>, 'type'> & { showLabel: string; hideLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...rest} type={shown ? 'text' : 'password'} className={`min-h-11 pe-12 text-base ${className ?? ''}`} />
      <button
        type="button"
        aria-pressed={shown}
        aria-label={shown ? hideLabel : showLabel}
        aria-controls={rest.id}
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-xl text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {shown ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
}
