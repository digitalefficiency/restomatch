'use client';

import { useRef } from 'react';
import { Field, Input } from '@/lib/components';
import { RememberMe } from '../../(auth)/_components/RememberMe';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';

/** The code field: `one-time-code`, digits only, submits itself on the 6th digit. */
export function LoginCodeForm({
  action,
  error,
  labels,
}: {
  action: (formData: FormData) => Promise<void>;
  error: boolean;
  labels: { code: string; submit: string; rememberMe: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  return (
    <form ref={formRef} action={action} className="space-y-4" data-testid="login-code-form">
      <Field label={labels.code} htmlFor="login-code">
        <Input
          id="login-code"
          name="code"
          required
          autoFocus
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
            if (digits.length === 6 && !sent.current) {
              sent.current = true;
              formRef.current?.requestSubmit();
            }
          }}
        />
      </Field>
      <RememberMe label={labels.rememberMe} />
      <SubmitButton className="min-h-12 w-full text-base">{labels.submit}</SubmitButton>
    </form>
  );
}
