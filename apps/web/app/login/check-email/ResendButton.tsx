'use client';

import { useEffect, useState } from 'react';
import { SubmitButton } from '../../(auth)/_components/SubmitButton';

/**
 * "Resend in 30 s" → "Resend": a UX countdown, counted client-side from the
 * server's wait. Not a security control — the server-side mail limits are.
 */
export function ResendButton({
  waitSec,
  label,
  countdownTemplate,
}: {
  waitSec: number;
  label: string;
  /** Already-translated text with a literal `{seconds}` slot. */
  countdownTemplate: string;
}) {
  const [left, setLeft] = useState(waitSec);
  useEffect(() => {
    setLeft(waitSec);
    if (waitSec <= 0) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      const l = Math.max(0, waitSec - Math.floor((Date.now() - started) / 1000));
      setLeft(l);
      if (l === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [waitSec]);
  return (
    <SubmitButton variant="secondary" disabled={left > 0} className="min-h-12 w-full text-base" data-testid="resend">
      {left > 0 ? countdownTemplate.replace('{seconds}', String(left)) : label}
    </SubmitButton>
  );
}
