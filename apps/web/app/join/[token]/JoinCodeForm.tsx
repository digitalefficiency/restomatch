'use client';

import { useEffect, useRef, useState } from 'react';
import { Field, Input } from '@/lib/components';
import { PasswordInput } from '../../(auth)/_components/PasswordInput';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy';
import { completeJoinAction } from '../actions';

export interface JoinCodeFormLabels {
  name: string;
  nameHint: string;
  password: string;
  passwordHint: string;
  code: string;
  rememberMe: string;
  submit: string;
  showPassword: string;
  hidePassword: string;
}

/**
 * Name + password + the 6-digit code. The code field is `one-time-code` (iOS /
 * Android offer it from the e-mail) and the form submits itself once all six
 * digits are in and the other fields are filled. "Remember me" is pre-checked
 * only when the app runs installed (standalone display mode) — a shared
 * browser on a kitchen tablet stays unchecked.
 */
export function JoinCodeForm({ token, labels, error }: { token: string; labels: JoinCodeFormLabels; error?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [standalone, setStandalone] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    setStandalone(typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true);
  }, []);

  function onCodeInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const digits = el.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== el.value) el.value = digits;
    const form = formRef.current;
    if (digits.length === 6 && form && !submitted.current && form.checkValidity()) {
      submitted.current = true;
      form.requestSubmit();
    }
  }

  return (
    <form ref={formRef} action={completeJoinAction} className="space-y-4" data-testid="join-code-form">
      <input type="hidden" name="token" value={token} />
      <Field label={labels.name} htmlFor="join-name" hint={labels.nameHint}>
        <Input id="join-name" name="name" required minLength={2} maxLength={80} autoComplete="name" className="min-h-11 text-base" />
      </Field>
      <div>
        <label htmlFor="join-password" className="mb-1.5 block text-sm font-medium text-muted">
          {labels.password}
        </label>
        <PasswordInput
          id="join-password"
          name="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          dir="ltr"
          className="rtl:text-right"
          showLabel={labels.showPassword}
          hideLabel={labels.hidePassword}
          aria-describedby="join-password-hint"
        />
        <p id="join-password-hint" className="mt-1.5 text-sm text-muted">
          {labels.passwordHint}
        </p>
      </div>
      <Field label={labels.code} htmlFor="join-code">
        <Input
          id="join-code"
          name="code"
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          dir="ltr"
          className="min-h-12 text-center text-xl font-semibold tracking-[0.4em] tabular-nums"
          onInput={onCodeInput}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'join-error' : undefined}
        />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
        <input
          type="checkbox"
          name="rememberMe"
          className="h-5 w-5 accent-primary"
          checked={standalone}
          onChange={(e) => setStandalone(e.currentTarget.checked)}
        />
        {labels.rememberMe}
      </label>
      <SubmitButton className="min-h-12 w-full text-base">{labels.submit}</SubmitButton>
    </form>
  );
}
