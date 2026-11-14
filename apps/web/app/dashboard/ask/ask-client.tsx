'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, Loader2, Send, Square, User } from 'lucide-react';
import type { AskResult } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Textarea } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { ask as askNs } from '@/lib/i18n/messages/ask';
import type { Translator } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { opsLines } from './ops-lines';
import {
  appendTurn,
  autoSubmitQuestion,
  loadThread,
  saveThread,
  settleTurn,
  withoutQ,
  type AskTurn,
} from './thread';
import { intentChip, intentCopy, intentFromCanned } from './intent';

const SUGGESTIONS = [
  'leakChange',
  'priceRaise',
  'claimWeek',
  'leakTotal',
  'topSupplier',
  // AU-06: what needs me
  'waitingForMe',
  'intakeStuck',
  'whoOwesMe',
  'toPayThisWeek',
  'vatAtRisk',
] as const;

type T = Translator<typeof askNs.he>;
type Turn = AskTurn & { result?: AskResult };
// The offline facts bag is shaped per intent server-side (ask/offline.ts); read it loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Facts = Record<string, any>;

function typeLabel(t: T, type: unknown): string {
  const key = `types.${String(type)}` as Parameters<T>[0];
  const label = t(key);
  return label === key ? String(type) : label;
}

/** Offline answer: facts → a sentence in the user's language, ₪ via formatIls(). */
export function offlineLines(r: AskResult, t: T, locale: Locale): string[] {
  const f = r.facts as Facts;
  const ils = (v: unknown) => formatIls(Number(v ?? 0), { locale });
  const pct = (v: unknown) => `${formatNumber(Number(v ?? 0), locale, { maximumFractionDigits: 1 })}%`;
  switch (r.intent) {
    case 'leakTotal':
      return [
        f.leakPct == null
          ? t('answers.leakTotalNoPct', { leak: ils(f.leakIls), invoices: f.invoicesWithLeak, caught: ils(f.caughtIls) })
          : t('answers.leakTotal', {
              leak: ils(f.leakIls),
              pct: pct(f.leakPct),
              invoices: f.invoicesWithLeak,
              caught: ils(f.caughtIls),
            }),
      ];
    case 'leakChange': {
      const d = Number(f.deltaIls ?? 0);
      const vars = { delta: ils(Math.abs(d)), leak: ils(f.leakIls), prev: ils(f.prevLeakIls), span: f.spanLabel, curSpan: f.curSpanLabel, prevSpan: f.prevSpanLabel };
      const out = [Math.abs(d) < 1 ? t('answers.leakSame', vars) : t(d > 0 ? 'answers.leakUp' : 'answers.leakDown', vars)];
      if (f.topSupplier) out.push(t('answers.leakDriverSupplier', { supplier: f.topSupplier, amount: ils(f.topSupplierDeltaIls) }));
      if (f.topType) out.push(t('answers.leakDriverType', { type: typeLabel(t, f.topType), amount: ils(f.topTypeDeltaIls) }));
      return out;
    }
    case 'priceRaise': {
      const items = (f.items ?? []) as Facts[];
      if (items.length === 0) return [t('answers.priceNone')];
      return [
        t('answers.priceIntro'),
        ...items.map((p) =>
          t('answers.priceItem', {
            product: p.product ?? '—',
            supplier: p.supplier ?? '—',
            before: formatIls(p.beforePrice, { locale, maximumFractionDigits: 2 }),
            after: formatIls(p.afterPrice, { locale, maximumFractionDigits: 2 }),
            pct: `+${pct(p.deltaPct)}`,
            excess: ils(p.excessIls),
          }),
        ),
      ];
    }
    case 'claimWeek': {
      const items = (f.items ?? []) as Facts[];
      // Nothing to claim only when NO basis has a line (a duplicate incl. VAT is still a claim).
      if (!f.count && !f.otherBasisCount) return [t('answers.claimNone')];
      return [
        ...(f.count ? [t('answers.claimIntro', { total: ils(f.totalIls), count: f.count })] : []),
        ...(f.otherBasisCount ? [t('answers.claimOther', { incl: ils(f.duplicateInclVatIls), vat: ils(f.vatIls) })] : []),
        ...items.map((c) =>
          t('answers.claimItem', {
            supplier: c.supplier ?? '—',
            item: c.item ?? '—',
            type: typeLabel(t, c.type),
            amount: formatIls(c.amountIls, { locale, maximumFractionDigits: 2 }),
          }),
        ),
      ];
    }
    case 'topSupplier':
      return f.supplier
        ? [t('answers.topSupplier', { supplier: f.supplier, leak: ils(f.leakIls), spend: ils(f.spendIls) })]
        : [t('answers.topSupplierNone')];
    case 'waitingForMe':
    case 'intakeStuck':
    case 'whoOwesMe':
    case 'toPayThisWeek':
    case 'vatAtRisk':
      return opsLines(r.intent, f, t, locale);
    default:
      return [t('answers.unknown')];
  }
}

function citationValue(c: AskResult['citations'][number], locale: Locale): string | null {
  if (c.value == null) return null;
  if (c.unit === 'ils') return formatIls(c.value, { locale });
  if (c.unit === 'pct') return `${formatNumber(c.value, locale, { maximumFractionDigits: 1 })}%`;
  return formatNumber(c.value, locale);
}

export function AskClient({
  claude,
  questionsLeftToday,
}: {
  claude: boolean;
  questionsLeftToday: number;
}) {
  const t = useT(askNs);
  const locale = useLocale();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [left, setLeft] = useState(questionsLeftToday);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  const client = trpc.useUtils().client;

  const storage = () => (typeof window === 'undefined' ? undefined : window.sessionStorage);

  async function submit(q: string) {
    const text = q.trim();
    if (text.length < 2 || pending) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setTurns(
      (prev) => appendTurn(prev, { id, question: text, answer: null, at: Date.now() }) as Turn[],
    );
    setQuestion('');
    const ac = new AbortController();
    abortRef.current = ac;
    setPending(true);
    try {
      const result = await client.ask.ask.mutate({ question: text, locale }, { signal: ac.signal });
      setTurns((prev) => settleTurn(prev, id, { result, ungrounded: !result.grounded }) as Turn[]);
      setLeft((n) => Math.max(0, n - 1));
    } catch (err) {
      // "עצור" aborts the wait; the burst limit is a calm "wait a moment", not a red failure.
      const code = (err as { data?: { code?: string } } | null)?.data?.code;
      const error = ac.signal.aborted
        ? 'stopped'
        : code === 'TOO_MANY_REQUESTS'
          ? 'rateLimited'
          : 'generic';
      setTurns((prev) => settleTurn(prev, id, { error }) as Turn[]);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setPending(false);
    }
  }

  // Restore this tab's thread, then ask a `?q=` question once (palette "שאלו: …", deep links).
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setTurns(loadThread(storage()) as Turn[]);
    const q = autoSubmitQuestion(window.location.search);
    if (q) {
      window.history.replaceState(
        null,
        '',
        withoutQ(window.location.pathname, window.location.search),
      );
      void submit(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loadedRef.current) saveThread(storage(), turns);
  }, [turns]);

  function rephrase(q: string) {
    setQuestion(q);
    document.getElementById('ask-question')?.focus();
  }

  return (
    <div className="space-y-4 pb-2" data-testid="ask-page">
      <div aria-label={t('suggestionsLabel')} className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => submit(t(`suggestions.${k}`))}
            disabled={pending}
            className="min-h-10 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
            data-testid={`ask-suggestion-${k}`}
          >
            {t(`suggestions.${k}`)}
          </button>
        ))}
      </div>

      {turns.length === 0 ? <p className="text-sm text-subtle">{t('empty')}</p> : null}

      <ol className="space-y-4" aria-live="polite">
        {turns.map((turn) => {
          const chip =
            turn.result?.mode === 'offline' ? intentFromCanned(turn.result.intent) : null;
          return (
            <li key={turn.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <User className="mt-1 h-4 w-4 shrink-0 text-subtle" aria-label={t('you')} />
                <p className="font-medium text-ink" {...originalProps(turn.question)}>
                  {turn.question}
                </p>
              </div>
              <Card padding="md" className="space-y-3" data-testid="ask-answer">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span className="font-semibold text-ink">{t('assistant')}</span>
                  {turn.result ? (
                    <Badge tone={turn.result.mode === 'claude' ? 'accent' : 'neutral'}>
                      {t(`mode.${turn.result.mode}`)}
                    </Badge>
                  ) : null}
                  {chip ? (
                    <span className="inline-flex items-center gap-2" data-testid="ask-intent">
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-ink">
                        {intentChip(chip, locale)}
                      </span>
                      <button
                        type="button"
                        onClick={() => rephrase(turn.question)}
                        className="min-h-9 underline underline-offset-2 hover:text-primary"
                        data-testid="ask-not-this"
                      >
                        {intentCopy[locale].notThis}
                      </button>
                    </span>
                  ) : null}
                </div>
                {turn.error ? (
                  <p
                    className={`text-sm ${turn.error === 'generic' ? 'text-danger' : 'text-muted'}`}
                  >
                    {t(
                      turn.error === 'rateLimited'
                        ? 'rateLimited'
                        : turn.error === 'stopped'
                          ? 'stopped'
                          : 'error',
                    )}
                  </p>
                ) : !turn.result ? (
                  <p className="inline-flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t('thinking')}
                  </p>
                ) : (
                  <AnswerBody result={turn.result} t={t} locale={locale} />
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
        className="sticky bottom-0 z-10 space-y-2 rounded-2xl border border-line bg-surface p-3 shadow-card"
        data-testid="ask-composer"
      >
        <label htmlFor="ask-question" className="sr-only">
          {t('label')}
        </label>
        <Textarea
          id="ask-question"
          rows={2}
          maxLength={500}
          value={question}
          placeholder={t('placeholder')}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit(question);
            }
          }}
          data-testid="ask-input"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-subtle">
            {claude ? t('questionsLeft', { count: formatNumber(left, locale) }) : ''}
          </span>
          {pending ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => abortRef.current?.abort()}
              data-testid="ask-stop"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              {t('stop')}
            </Button>
          ) : (
            <Button type="submit" disabled={question.trim().length < 2} data-testid="ask-submit">
              <Send className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
              {t('submit')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function AnswerBody({ result, t, locale }: { result: AskResult; t: T; locale: Locale }) {
  const lines = result.mode === 'claude' ? [result.answer ?? ''] : offlineLines(result, t, locale);
  const seen = new Set<string>();
  const sources = result.mode === 'claude'
    ? result.citations.map((c) => ({ href: c.href, label: t(`screens.${c.screen}`), value: citationValue(c, locale) }))
    : result.links.map((l) => ({ href: l.href, label: t(`screens.${l.screen}`), value: null as string | null }));
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {!result.grounded ? (
        <p role="note" className="flex items-start gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-ink" data-testid="ask-ungrounded">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden="true" />
          {t('ungrounded')}
        </p>
      ) : null}
      {lines.map((line, i) => (
        <p key={i} {...originalProps(line)} className={i > 0 && result.mode === 'offline' ? 'ps-3' : undefined}>
          {line}
        </p>
      ))}
      {result.mode === 'offline' && result.reason ? (
        <p className="text-xs text-subtle">{t(`offlineNote.${result.reason}`)}</p>
      ) : null}
      {sources.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted">{t('sources')}</p>
          <ul className="flex flex-wrap gap-2">
            {sources
              .filter((s) => (seen.has(s.href + s.label) ? false : (seen.add(s.href + s.label), true)))
              .slice(0, 8)
              .map((s) => (
                <li key={s.href + s.label}>
                  <Link
                    href={s.href}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink hover:border-primary/40 hover:text-primary"
                    data-testid="ask-source"
                  >
                    <span {...originalProps(s.label)}>{s.label}</span>
                    {s.value ? <span className="font-mono tabular-nums text-primary">{s.value}</span> : null}
                    <ArrowLeft className="h-3 w-3 ltr:-scale-x-100" aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
