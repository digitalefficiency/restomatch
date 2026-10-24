'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { leakCheck } from '@/lib/i18n/messages/leakCheck';

/** "Book a demo" (creates a lead from the result) + "start a trial with these results". */
export function DemoCta({ token }: { token: string }) {
  const t = useT(leakCheck);
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await fetch('/api/leak-check/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, phone: phone.trim() || undefined }),
      });
      setState(res.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      {state === 'sent' ? (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-primary">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          {t('result.demoSent')}
        </p>
      ) : (
        <form onSubmit={send} className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm text-muted">
            <span className="mb-1.5 block font-medium">{t('result.demoPhone')}</span>
            <Input
              type="tel"
              inputMode="tel"
              dir="ltr"
              maxLength={32}
              autoComplete="tel"
              className="h-12"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={state === 'sending'}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-70"
          >
            {t('result.ctaDemo')}
          </button>
        </form>
      )}
      <Link
        href={`/leak-check/claim?t=${encodeURIComponent(token)}`}
        className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface-2 px-5 py-3 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary"
      >
        {t('result.ctaTrial')}
      </Link>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-danger">
          {t('result.demoError')}
        </p>
      ) : null}
    </div>
  );
}
