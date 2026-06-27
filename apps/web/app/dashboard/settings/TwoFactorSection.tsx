'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Field, Input } from '@/lib/components';
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
  const [enabled, setEnabled] = useState(initialEnabled);
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
        setError('לא ניתן להתחיל הרשמה. נסו שוב.');
      }
    });
  }

  function confirm(formData: FormData) {
    const code = String(formData.get('code') ?? '').trim();
    setError(null);
    startTransition(async () => {
      const res = await confirmTwoFactorEnrollmentAction(code);
      if (!res.ok) {
        setError('הקוד שגוי. ודאו שהשעה במכשיר מסונכרנת ונסו שוב.');
        return;
      }
      setRecoveryCodes(res.recoveryCodes ?? []);
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
        setError('הקוד שגוי. נדרש קוד נוכחי כדי לכבות אימות דו-שלבי.');
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
          <h3 className="text-base font-semibold text-ink">אימות דו-שלבי (2FA)</h3>
          <p className="text-sm text-muted">
            {enabled
              ? `מופעל — שכבת הגנה נוספת בכל כניסה. נותרו ${recoveryRemaining} קודי שחזור.`
              : 'מומלץ להפעיל — נדרש קוד חד-פעמי מאפליקציית אימות בנוסף לסיסמה או לקישור.'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-muted'
          }`}
        >
          {enabled ? 'פעיל' : 'כבוי'}
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* IDLE */}
      {phase === 'idle' && !enabled ? (
        <Button onClick={begin} disabled={pending}>
          הפעלת אימות דו-שלבי
        </Button>
      ) : null}

      {phase === 'idle' && enabled ? (
        <form action={disable} className="space-y-3">
          <Field label="כיבוי — הזינו קוד נוכחי לאישור" htmlFor="disable-code">
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
            כיבוי אימות דו-שלבי
          </Button>
        </form>
      ) : null}

      {/* ENROLLING */}
      {phase === 'enrolling' && challenge ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            סרקו את הקוד באפליקציית אימות (Google Authenticator, 1Password וכו׳), או הזינו את
            המפתח ידנית:
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={challenge.qrDataUrl}
            alt="קוד QR להרשמת אימות דו-שלבי"
            width={200}
            height={200}
            className="rounded-md border border-border"
          />
          <code className="block break-all rounded bg-border/30 px-2 py-1 text-xs" dir="ltr">
            {challenge.secret}
          </code>
          <form action={confirm} className="space-y-3">
            <Field label="הזינו את הקוד מהאפליקציה לאישור" htmlFor="confirm-code">
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
                אישור והפעלה
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
                ביטול
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* SHOW RECOVERY CODES (once) */}
      {phase === 'showCodes' ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">
            שמרו את קודי השחזור הבאים במקום בטוח — הם מוצגים פעם אחת בלבד. כל קוד תקף לשימוש יחיד
            אם איבדתם גישה לאפליקציה.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md bg-border/20 p-3 font-mono text-sm" dir="ltr">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setPhase('idle');
              setRecoveryCodes([]);
            }}
          >
            שמרתי את הקודים
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
