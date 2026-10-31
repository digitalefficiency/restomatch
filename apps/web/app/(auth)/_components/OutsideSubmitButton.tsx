'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/lib/components';

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * A submit button that lives OUTSIDE its <form> and joins it through the `form`
 * attribute. Used for the secondary sign-in actions (email link): the form's
 * only in-tree submit stays the password one, so Enter in the password field
 * always tries the password (a form's implicit submission uses its first
 * submit button). `useFormStatus` can't see an outside button, so the pending
 * state is its own: disabled + spinner from the click until the page changes.
 */
export function OutsideSubmitButton({
  form,
  onClick,
  disabled,
  ...rest
}: Omit<ButtonProps, 'type' | 'loading'> & { form: string }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // Back/forward cache restores the page with the old state: re-enable.
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <Button
      type="submit"
      form={form}
      {...rest}
      disabled={disabled || pending}
      loading={pending}
      onClick={(e) => {
        onClick?.(e);
        // Disable only after this click has started the submission.
        if (!e.defaultPrevented) window.setTimeout(() => setPending(true), 0);
      }}
    />
  );
}
