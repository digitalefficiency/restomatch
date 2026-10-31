'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/lib/components';

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * A server-action submit with a pending state (auth-20): while its form is
 * submitting every SubmitButton in it is disabled (no double magic link on slow
 * 4G), and the one that was pressed shows the spinner. Width never changes —
 * the label stays, the spinner sits beside it.
 */
export function SubmitButton({ children, onClick, disabled, ...rest }: Omit<ButtonProps, 'type' | 'loading'>) {
  const { pending } = useFormStatus();
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!pending) setPressed(false);
  }, [pending]);
  return (
    <Button
      type="submit"
      {...rest}
      disabled={disabled || pending}
      loading={pending && pressed}
      onClick={(e) => {
        setPressed(true);
        onClick?.(e);
      }}
    >
      {children}
    </Button>
  );
}
