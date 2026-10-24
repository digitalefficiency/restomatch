'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Field, Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import {
  confirmTwoFactorEnrollmentAction,
  disableTwoFactorAction,
  startTwoFactorEnrollmentAction,
} from './two-factor-actions';

interface Props {
  initialEnabled: boolean;
  recoveryRemaining: number;
}

type Phase = 'idle' | 'enrolling' | 'showCodes';

interface Challenge {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/**
 * Client UI for the 2FA (TOTP) lifecycle (Epic C.1): enable → scan QR → confirm
 * a code → save one-time recovery codes; and disable (requires a current code).
 * All verification happens server-side; this component only orchestrates the
 * steps and never sees the secret beyond the QR it must display.
 */
export function TwoFactorSection({ initialEnabled, recoveryRemaining }: Props) {
  const t = useT(settings);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [remaining, setRemaining] = useState(recoveryRemaining);
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      try {
        const c = await startTwoFactorEnrollmentAction();
        setChallenge(c);
        setPhase('enrolling');
      } catch {
        setError(t('twoFactor.startFailed'));
      }
    });
  }

  function confirm(formData: FormData) {
    const code = String(formData.get('code') ?? '').trim();
    setError(null);
    startTransition(async () => {
      const res = await confirmTwoFactorEnrollmentAction(code);
      if (!res.ok) {
        setError(t('twoFactor.wrongCode'));
        return;
      }
      setRecoveryCodes(res.recoveryCodes ?? []);
      setRemaining(res.recoveryCodes?.length ?? 0);
      setEnabled(true);
      setPhase('showCodes');
    });
  }

  function disable(formData: FormData) {
    const code = String(formData.get('code') ?? '').trim();
    setError(null);
    startTransition(async () => {
      const res = await disableTwoFactorAction(code);
      if (!res.ok) {
        setError(t('twoFactor.wrongDisableCode'));
        return;
      }
      setEnabled(false);
      setPhase('idle');
      setChallenge(null);
    });
  }

  return (
    <Card flow padding="lg" className="max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-ink">{t('twoFactor.title')}</h3>
          <p className="text-sm text-muted">
            {enabled
              ? t('twoFactor.enabledBody', { count: remaining })
              : t('twoFactor.disabledBody')}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            enabled ? 'bg-primary/10 text-primary' : 'bg-line/40 text-muted'
          }`}
        >
          {enabled ? t('twoFactor.on') : t('twoFactor.off')}
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* IDLE */}
      {phase === 'idle' && !enabled ? (
        <Button onClick={begin} disabled={pending}>
          {t('twoFactor.enable')}
        </Button>
      ) : null}

      {phase === 'idle' && enabled ? (
        <form action={disable} className="space-y-3">
          <Field label={t('twoFactor.disableLabel')} htmlFor="disable-code">
            <Input
              id="disable-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              placeholder="123456"
              dir="ltr"
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('twoFactor.disable')}
          </Button>
        </form>
      ) : null}

      {/* ENROLLING */}
      {phase === 'enrolling' && challenge ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {t('twoFactor.scanHint')}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={challenge.qrDataUrl}
            alt={t('twoFactor.qrAlt')}
            width={200}
            height={200}
            className="rounded-md border border-line"
          />
          <code className="block break-all rounded bg-line/30 px-2 py-1 text-xs" dir="ltr">
            {challenge.secret}
          </code>
          <form action={confirm} className="space-y-3">
            <Field label={t('twoFactor.confirmLabel')} htmlFor="confirm-code">
              <Input
                id="confirm-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
                dir="ltr"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {t('twoFactor.confirm')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setPhase('idle');
                  setChallenge(null);
                  setError(null);
                }}
              >
                {t('twoFactor.cancel')}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* SHOW RECOVERY CODES (once) */}
      {phase === 'showCodes' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">
            {t('twoFactor.codesIntro')}
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md bg-line/20 p-3 font-mono text-sm" dir="ltr">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                setCopied(true);
              }}
            >
              {copied ? t('twoFactor.copied') : t('twoFactor.copyCodes')}
            </Button>
            <Button
              onClick={() => {
                setPhase('idle');
                setRecoveryCodes([]);
                setCopied(false);
              }}
            >
              {t('twoFactor.savedCodes')}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
