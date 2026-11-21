'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Card, cn } from '@/lib/components';
import { useLocale } from '@/lib/i18n/client';
import { claimCopy, fill } from './copy';

export interface ClaimFormLine {
  claimId: string;
  /** "חשבונית 123 · 12 באוק׳ 2026", already formatted (or null when unknown). */
  invoice: string | null;
  item: string;
  /** The reason, already in partner wording. */
  reason: string;
  /** ₪, already formatted by formatIls() on the server. */
  amount: string;
}

type Answer = 'agree' | 'check';
type Phase = { kind: 'edit' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string };

const fieldClass =
  'mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/**
 * The supplier answers each line: "מאשרים — תצא חשבונית זיכוי" or "נבדוק יחד"
 * (with an optional line note). One filled primary (send); "agree to all" is a
 * quiet secondary. Lines left unanswered stay open for a later visit.
 */
export function ClaimAnswerForm({
  token,
  restaurant,
  lines,
  totalText,
}: {
  token: string;
  restaurant: string;
  lines: ClaimFormLine[];
  totalText: string;
}) {
  const c = claimCopy(useLocale());
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [creditNo, setCreditNo] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' });
  const answered = lines.filter((l) => answers[l.claimId]);

  async function send() {
    if (answered.length === 0) {
      setPhase({ kind: 'error', message: c.pickOne });
      return;
    }
    setPhase({ kind: 'sending' });
    const body = {
      lines: answered.map((l) => ({
        claimId: l.claimId,
        answer: answers[l.claimId]!,
        note: answers[l.claimId] === 'check' && lineNotes[l.claimId]?.trim() ? lineNotes[l.claimId]!.trim() : null,
      })),
      creditNoteNumber: creditNo.trim() || null,
      note: note.trim() || null,
    };
    try {
      const res = await fetch(`/api/claims/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (res.ok) return setPhase({ kind: 'done' });
      const message =
        res.status === 409
          ? c.alreadyAnswered
          : res.status === 410
            ? c.expiredBody
            : res.status === 404
              ? c.inactiveBody
              : res.status === 429
                ? c.rateLimited
                : c.generic;
      setPhase({ kind: 'error', message });
    } catch {
      setPhase({ kind: 'error', message: c.generic });
    }
  }

  if (phase.kind === 'done') {
    return (
      <Card elevated padding="md" className="mt-6" data-testid="claim-portal-done">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-bold text-ink">{c.doneTitle}</h2>
            <p className="mt-1 text-base text-ink">{fill(c.doneBody, { restaurant })}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form
      className="mt-6 grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      data-testid="claim-portal-form"
    >
      <ul className="grid gap-3">
        {lines.map((l) => {
          const a = answers[l.claimId];
          const group = `answer-${l.claimId}`;
          return (
            <li key={l.claimId}>
              <Card padding="md">
                <fieldset>
                  <legend className="w-full">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-base font-semibold text-ink">{l.item}</span>
                      <bdi className="shrink-0 text-base font-bold tabular-nums text-ink">{l.amount}</bdi>
                    </span>
                    {l.invoice ? <span className="mt-0.5 block text-sm text-muted">{l.invoice}</span> : null}
                    <span className="mt-1 block text-sm text-ink">{l.reason}</span>
                  </legend>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(['agree', 'check'] as const).map((opt) => (
                      <label
                        key={opt}
                        className={cn(
                          'flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-ink',
                          a === opt ? 'border-primary bg-primary/10' : 'border-line-strong bg-surface hover:border-primary/40',
                        )}
                      >
                        <input
                          type="radio"
                          name={group}
                          value={opt}
                          checked={a === opt}
                          onChange={() => setAnswers((s) => ({ ...s, [l.claimId]: opt }))}
                          className="h-4 w-4 accent-primary"
                        />
                        {opt === 'agree' ? c.agree : c.check}
                      </label>
                    ))}
                  </div>
                  {a === 'check' ? (
                    <label className="mt-3 block text-sm text-ink">
                      {c.lineNote}
                      <textarea
                        className={fieldClass}
                        rows={2}
                        maxLength={500}
                        placeholder={c.lineNotePlaceholder}
                        value={lineNotes[l.claimId] ?? ''}
                        onChange={(e) => setLineNotes((s) => ({ ...s, [l.claimId]: e.target.value }))}
                      />
                    </label>
                  ) : null}
                </fieldset>
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="flex items-baseline justify-between text-base font-semibold text-ink">
        <span>{c.total}</span>
        <bdi className="tabular-nums">{totalText}</bdi>
      </p>

      <label className="block text-sm text-ink">
        {c.creditNoteNumber}
        <input className={fieldClass} maxLength={64} value={creditNo} onChange={(e) => setCreditNo(e.target.value)} dir="auto" />
      </label>
      <label className="block text-sm text-ink">
        {c.note}
        <textarea
          className={fieldClass}
          rows={2}
          maxLength={500}
          placeholder={c.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {phase.kind === 'error' ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {phase.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 grid gap-2 bg-bg/95 py-3 sm:grid-cols-[auto_1fr]">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAnswers(Object.fromEntries(lines.map((l) => [l.claimId, 'agree' as const])))}
        >
          {c.agreeAll}
        </Button>
        <Button type="submit" variant="primary" loading={phase.kind === 'sending'}>
          {phase.kind === 'sending' ? c.sending : fill(c.submit, { count: answered.length })}
        </Button>
      </div>
    </form>
  );
}
