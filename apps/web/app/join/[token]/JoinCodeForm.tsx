'use client';

import { useRef } from 'react';
import { Field, Input } from '@/lib/components';
import { PasswordInput } from '../../(auth)/_components/PasswordInput';
import { RememberMe } from '../../(auth)/_components/RememberMe';
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
 * digits are in and the other fields are filled. "Remember me" starts unchecked
 * (shared receiving tablets) and sits above the code field, so the auto-submit
 * never skips it (WCAG 3.2.2).
 */
export function JoinCodeForm({ token, labels, error }: { token: string; labels: JoinCodeFormLabels; error?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);


  function onCodeInput(e: React.FormEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const digits = el.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== el.value) el.value = digits;
    if (digits.length < 6) submitted.current = false;
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
      <RememberMe label={labels.rememberMe} />
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
      <SubmitButton className="min-h-12 w-full text-base">{labels.submit}</SubmitButton>
    </form>
  );
}
