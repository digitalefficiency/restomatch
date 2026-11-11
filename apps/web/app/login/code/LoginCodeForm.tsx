'use client';

import { useRef } from 'react';
import { Field, Input } from '@/lib/components';
import { RememberMe } from '../../(auth)/_components/RememberMe';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';

/**
 * The code field: `one-time-code`, digits only, submits itself on the 6th digit.
 * "Remember me" sits ABOVE the code field, so the auto-submit never jumps past
 * a choice the user has not reached yet (WCAG 3.2.2).
 */
export function LoginCodeForm({
  action,
  error,
  disabled,
  labels,
}: {
  action: (formData: FormData) => Promise<void>;
  error: boolean;
  disabled: boolean;
  labels: { code: string; submit: string; rememberMe: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  return (
    <form ref={formRef} action={action} className="space-y-4" data-testid="login-code-form">
      <RememberMe label={labels.rememberMe} />
      <Field label={labels.code} htmlFor="login-code">
        <Input
          id="login-code"
          name="code"
          required
          autoFocus
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          dir="ltr"
          className="min-h-12 text-center text-xl font-semibold tracking-[0.4em] tabular-nums"
          aria-invalid={error || undefined}
          aria-describedby={error ? 'login-code-error' : undefined}
          onInput={(e) => {
            const el = e.currentTarget;
            const digits = el.value.replace(/\D/g, '').slice(0, 6);
            if (digits !== el.value) el.value = digits;
            // A corrected code (after a wrong one) must be able to submit again.
            if (digits.length < 6) sent.current = false;
            if (digits.length === 6 && !sent.current) {
              sent.current = true;
              formRef.current?.requestSubmit();
            }
          }}
        />
      </Field>
      <SubmitButton className="min-h-12 w-full text-base" disabled={disabled}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
