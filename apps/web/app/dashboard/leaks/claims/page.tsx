import Link from 'next/link';
import { ArrowRight, FileCheck2, Send } from 'lucide-react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { leaks as leaksNs } from '@/lib/i18n/messages/leaks';
import { approvals as approvalsNs } from '@/lib/i18n/messages/approvals';
import { recovery as recoveryNs } from '@/lib/i18n/messages/recovery';
import { activeMembershipOf } from '@/lib/activeRestaurant';
import { Badge, Card, EmptyState, SectionHeader } from '@/lib/components';
import { discrepancyLabel, displayName } from '../../approvals/vocab';
import { PrintButton } from './print-button';
import { LetterActions } from './letter-actions';
import { DeferredProvider } from '../../recovery/deferred';
import { canEditLetterhead, letterheadBlock } from './letterhead';
import { addDays, buildLetters, daysLeft, sumAgora, type LetterLine, type SupplierLetter } from './letters';
import { lineMathText } from './why';
import { ALL_CLAIMS, ANSWER_DAYS } from '../../recovery/logic';

const REASON_TYPES = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Months of breakdown looked up to show the basis (date, expected vs charged) of tracker lines. */
const HISTORY_MONTHS = 6;

/**
 * Supplier credit-request letters (מכתבי דרישת זיכוי): ONE letter per supplier
 * (letters.ts) with a "before payment" section (this month's unpaid invoices)
 * and a "for credit" section (₪-back claims still waiting for a letter), one
 * total, the ₪ basis of every line, a reply-by date and the ACTIVE restaurant
 * as the sender. Each letter prints alone, hands off to WhatsApp / email from
 * the user's own device, and "mark as sent" moves its claims to letter_sent.
 * `?m=-1` = previous month · `?sup=<id>` = one supplier.
 */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ m?: string; sup?: string }> }) {
  const sp = await searchParams;
  const parsed = Number.parseInt(sp.m ?? '0', 10);
  const monthOffset = Number.isFinite(parsed) ? Math.min(0, Math.max(-24, parsed)) : 0;
  const onlySupplier = sp.sup && UUID_RE.test(sp.sup) ? sp.sup : null;

  const caller = await createServerCaller();
  const session = await auth();
  const [t, ta, tr, locale] = await Promise.all([getT(leaksNs), getT(approvalsNs), getT(recoveryNs), getLocale()]);
  const [hero, rows, memberships, profile, flags, options, letterhead] = await Promise.all([
    caller.owner.leakHero({ monthOffset }),
    caller.owner.leakBreakdown({ monthOffset, limit: 200 }),
    caller.onboarding.myMemberships(),
    caller.settings.profile(),
    caller.recovery.flags(),
    caller.owner.viewOptions(),
    caller.settings.letterhead(),
  ]);
  // Tracker claims (any status: `claimed` get letters, `letter_sent` show as sent, the rest are handled).
  // No .catch: a failed read is the route's error state ("not available · try again"), never "no letters".
  const tracked = flags.recovery ? await caller.recovery.list({ limit: ALL_CLAIMS }) : [];
  const history = flags.recovery
    ? (
        await Promise.all(
          Array.from({ length: HISTORY_MONTHS }, (_, i) => -i)
            .filter((o) => o !== monthOffset)
            .map((o) => caller.owner.leakBreakdown({ monthOffset: o, limit: 200 })),
        )
      ).flat()
    : [];

  // The sender is the ACTIVE restaurant (the session's), never memberships[0].
  const restaurant =
    activeMembershipOf(memberships, session?.user?.restaurantId)?.restaurantName ?? profile.name ?? '';
  // The sender block: the letterhead the owner filled once (settings), the ח״פ falling back to the profile's.
  const sender = letterheadBlock(letterhead, profile.businessId);
  const businessId = sender.businessId;
  const role = (session?.user as { role?: string } | undefined)?.role;
  const signer = session?.user?.name?.trim() || '';
  const nowIso = new Date().toISOString();
  const replyBy = formatDate(addDays(nowIso, ANSWER_DAYS), locale);
  const month = formatDate(hero.monthStart, locale, { month: 'long', year: 'numeric' });
  const today = formatDate(nowIso, locale, { dateStyle: 'long' });
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const supplierIdByName = new Map(options.suppliers.map((s) => [s.name, s.id]));

  const built = buildLetters({ month: rows, tracked, history });
  const withIds = built.letters.map((l) => ({
    ...l,
    supplierId: l.supplierId ?? (l.supplierName ? (supplierIdByName.get(l.supplierName) ?? null) : null),
  }));
  const letters = onlySupplier ? withIds.filter((l) => l.supplierId === onlySupplier) : withIds;
  const sent = onlySupplier ? built.sent.filter((s) => s.supplierId === onlySupplier) : built.sent;
  // Lines nobody decided on yet are never in a letter (decision 18): a T2 "decide" prompt instead.
  const onlyName = onlySupplier ? (options.suppliers.find((s) => s.id === onlySupplier)?.name ?? '').trim() : null;
  const undecided = onlySupplier
    ? (built.undecided.bySupplier.get(onlyName || '—') ?? { count: 0, amount: 0 })
    : built.undecided;
  const lineCount = letters.reduce((n, l) => n + l.beforePayment.length + l.forCredit.length, 0);
  const pageTotal = sumAgora(letters.map((l) => l.total));
  const filteredName = onlySupplier
    ? displayName(locale, options.suppliers.find((s) => s.id === onlySupplier)?.name ?? null, options.suppliers.find((s) => s.id === onlySupplier)?.nameEn ?? null)
    : null;

  const itemOf = (l: LetterLine) =>
    displayName(locale, l.productName, l.productNameEn) || displayName(locale, l.lineDescription, l.lineDescriptionEn) || '—';
  const supplierOf = (l: { supplierName: string | null; supplierNameEn: string | null }) =>
    displayName(locale, l.supplierName, l.supplierNameEn) || '—';

  const mathOf = (l: LetterLine) => lineMathText(l, locale);
  const reasonOf = (type: string) =>
    (REASON_TYPES as readonly string[]).includes(type)
      ? t(`claims.reason.${type as (typeof REASON_TYPES)[number]}`)
      : discrepancyLabel(ta, type);

  /** The plain text the user pastes into WhatsApp / email — exactly the letter's lines and total. */
  const textOf = (l: SupplierLetter) =>
    [
      t('claims.text.greeting', { supplier: supplierOf(l) }),
      t('claims.text.intro', { restaurant, amount: ils(l.total), count: formatNumber(l.beforePayment.length + l.forCredit.length, locale) }),
      ...[...l.beforePayment, ...l.forCredit].map((x) =>
        t('claims.text.line', {
          invoice: x.invoiceNumber ?? '—',
          item: itemOf(x),
          reason: reasonOf(x.type),
          amount: ils(x.amount),
        }),
      ),
      t('claims.text.total', { amount: ils(l.total) }),
      t('claims.text.replyBy', { date: replyBy }),
      t('claims.text.sign', { signer: signer || restaurant, restaurant }),
    ].join('\n');

  const lineList = (lines: LetterLine[], subtotalLabel: string, subtotal: number) => (
    <>
      <ul className="divide-y divide-line/60 border-y border-line/60">
        {lines.map((l) => {
          const math = mathOf(l);
          return (
            <li key={l.key} className="flex items-start justify-between gap-3 py-2.5 text-sm" data-testid="letter-line">
              <div className="min-w-0">
                <p className="text-ink print:text-black">
                  <bdi dir="ltr" className="whitespace-nowrap font-mono text-xs text-muted print:text-black">
                    {l.invoiceNumber ?? '—'}
                  </bdi>
                  {l.invoiceDate ? <span className="text-xs text-muted print:text-black"> · {formatDate(l.invoiceDate, locale)}</span> : null}
                  <span className="font-medium"> · {itemOf(l)}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted print:text-black">{reasonOf(l.type)}</p>
                {math ? <p className="mt-0.5 text-xs text-ink print:text-black" data-testid="letter-math">{math}</p> : null}
              </div>
              <div className="shrink-0 text-end">
                <span className="font-semibold tabular-nums text-ink print:text-black" data-testid="letter-line-amount" data-amount={l.amount}>
                  {ils(l.amount)}
                </span>
                <span className="block text-xs text-subtle print:text-black">{t(`claims.basis.${l.basis}`)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 flex justify-between gap-3 text-sm text-muted print:text-black">
        <span>{subtotalLabel}</span>
        <span className="font-semibold tabular-nums text-ink print:text-black">{ils(subtotal)}</span>
      </p>
    </>
  );

  const renderLetter = (letter: SupplierLetter, i: number) => {
    const scope = `claim-letter-${i}`;
    const mixed = new Set([...letter.beforePayment, ...letter.forCredit].map((l) => l.basis)).size > 1;
    return (
      <Card
        key={letter.key}
        as="article"
        elevated
        padding="lg"
        data-testid="supplier-letter"
        data-print-root={scope}
        aria-labelledby={`${scope}-to`}
        className="break-inside-avoid print:break-after-page print:border-0 print:bg-white print:text-black print:shadow-none"
      >
        <div className="flex flex-col gap-1 text-sm text-muted sm:flex-row sm:justify-between print:text-black">
          <div>
            <p id={`${scope}-to`} className="flex flex-wrap items-center gap-2 font-semibold text-ink print:text-black">
              {t('claims.to', { supplier: supplierOf(letter) })}
              <Badge tone="warning" className="print:hidden">
                {t('claims.toSend')}
              </Badge>
            </p>
            <p data-testid="letter-from">{t('claims.from', { restaurant })}</p>
            <div data-testid="letterhead">
              {sender.legalName ? <p data-testid="letterhead-legal-name">{sender.legalName}</p> : null}
              <p data-testid="letter-business-id">
                {businessId ? t('claims.businessId', { id: businessId }) : <span className="text-warn print:text-black">{t('claims.businessIdMissing')}</span>}
              </p>
              {sender.address ? <p data-testid="letterhead-address">{sender.address}</p> : null}
              {sender.phone || sender.email ? (
                <p data-testid="letterhead-contact">
                  {sender.phone ? (
                    <>
                      {t('claims.letterhead.phone')} <bdi dir="ltr">{sender.phone}</bdi>
                    </>
                  ) : null}
                  {sender.phone && sender.email ? ' · ' : null}
                  {sender.email ? (
                    <>
                      {t('claims.letterhead.email')} <bdi dir="ltr">{sender.email}</bdi>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            {sender.empty && canEditLetterhead(role) ? (
              <p className="mt-1 text-xs print:hidden" data-testid="letterhead-prompt">
                <Link href="/dashboard/settings#letterhead" className="font-semibold text-primary hover:underline">
                  {t('claims.letterhead.prompt')}
                </Link>
              </p>
            ) : null}
          </div>
          <p>{t('claims.date', { date: today })}</p>
        </div>
        <h2 className="mt-4 text-base font-bold text-ink print:text-black">{t('claims.subject', { month })}</h2>
        <p className="mt-2 text-sm text-muted print:text-black">
          {t('claims.intro')} <bdi className="font-semibold text-ink print:text-black">{ils(letter.total)}</bdi>{' '}
          {t('claims.introReplyBy', { date: replyBy })}
        </p>

        {letter.beforePayment.length > 0 ? (
          <section className="mt-4" aria-label={t('claims.sectionBeforePayment')}>
            <h3 className="mb-1.5 text-sm font-bold text-ink print:text-black">{t('claims.sectionBeforePayment')}</h3>
            {lineList(letter.beforePayment, t('claims.subtotal'), letter.beforePaymentTotal)}
          </section>
        ) : null}
        {letter.forCredit.length > 0 ? (
          <section className="mt-4" aria-label={t('claims.sectionForCredit')}>
            <h3 className="mb-1.5 text-sm font-bold text-ink print:text-black">{t('claims.sectionForCredit')}</h3>
            {lineList(letter.forCredit, t('claims.subtotal'), letter.forCreditTotal)}
          </section>
        ) : null}

        <p className="mt-3 flex items-baseline justify-between gap-3 border-t-2 border-ink pt-2 print:border-black">
          <span className="font-semibold text-ink print:text-black">{t('claims.total')}</span>
          <span className="text-xl font-extrabold tabular-nums text-ink print:text-black" data-testid="letter-total" data-amount={letter.total}>
            {ils(letter.total)}
          </span>
        </p>
        {mixed ? <p className="mt-2 text-xs text-subtle print:text-black">{t('claims.mixedBasis')}</p> : null}
        <p className="mt-4 text-sm text-muted print:text-black">{t('claims.closing', { date: replyBy })}</p>
        <p className="mt-3 text-sm text-muted print:text-black" data-testid="letter-signature">
          {t('claims.signature')}
          <br />
          {signer ? (
            <>
              <span className="font-semibold text-ink print:text-black">{signer}</span>
              <br />
            </>
          ) : null}
          <span className="font-semibold text-ink print:text-black">{restaurant}</span>
        </p>
        <div className="mt-5 border-t border-line pt-4">
          <LetterActions
            scope={scope}
            claimIds={letter.claimIds}
            whatsappText={textOf(letter)}
            mailSubject={t('claims.subject', { month })}
            labels={{
              print: t('claims.printOne'),
              whatsapp: t('claims.whatsapp'),
              mail: t('claims.mail'),
              markSent: t('claims.markSent'),
              markSentAria: t('claims.markSentAria', { supplier: supplierOf(letter), count: formatNumber(letter.claimIds.length, locale) }),
              sentBadge: t('claims.sentBadge', {
                date: formatDate(nowIso, locale, { day: '2-digit', month: '2-digit' }),
                days: formatNumber(ANSWER_DAYS, locale),
              }),
              undoMoved: t('claims.undoMoved', { supplier: supplierOf(letter), amount: ils(letter.total) }),
              failed: tr('actions.failed'),
              notTracked: t('claims.notTracked'),
            }}
          />
        </div>
      </Card>
    );
  };

  return (
    <div>
      {/* Per-letter print scopes (PrintButton `scope`): only the chosen letter prints. */}
      <style>
        {letters
          .map(
            (_, i) =>
              `@media print { html[data-print-scope="claim-letter-${i}"] [data-print-root="claim-letter-${i}"], html[data-print-scope="claim-letter-${i}"] [data-print-root="claim-letter-${i}"] * { visibility: visible; } html[data-print-scope="claim-letter-${i}"] [data-print-root="claim-letter-${i}"] { position: absolute; inset-inline: 0; top: 0; } }`,
          )
          .join('\n')}
      </style>
      <Link
        href={`/dashboard/leaks/breakdown${monthOffset ? `?m=${monthOffset}` : ''}`}
        className="mb-3 -ms-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:text-ink print:hidden"
      >
        <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        {t('breakdown.title')}
      </Link>
      <div className="print:hidden">
        <SectionHeader
          level={1}
          title={t('claims.title')}
          subtitle={t('claims.subtitle', { month })}
          action={letters.length > 0 ? <PrintButton label={t('claims.print')} /> : undefined}
        />
        {letters.length > 0 ? (
          <p className="-mt-2 mb-4 text-sm font-semibold text-ink" data-testid="claims-summary" data-amount={pageTotal}>
            {t('claims.summary', {
              suppliers: formatNumber(letters.length, locale),
              lines: formatNumber(lineCount, locale),
              amount: ils(pageTotal),
            })}
          </p>
        ) : null}
        {filteredName ? (
          <p className="mb-4 text-sm text-muted">
            {t('claims.filtered', { supplier: filteredName })}{' '}
            <Link href={`/dashboard/leaks/claims${monthOffset ? `?m=${monthOffset}` : ''}`} className="font-semibold text-primary hover:underline">
              {t('claims.showAll')}
            </Link>
          </p>
        ) : null}
      </div>

      {undecided.count > 0 ? (
        <Card
          padding="md"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 border-warn/40 print:hidden"
          data-testid="claims-undecided"
          data-amount={undecided.amount}
        >
          <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">
            <Badge tone="warning-solid">{t('claims.undecided.badge')}</Badge>
            <strong className="tabular-nums">{ils(undecided.amount)}</strong>
            <span>{t('claims.undecided.body', { count: formatNumber(undecided.count, locale) })}</span>
          </p>
          <Link
            href="/dashboard/approvals"
            className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary hover:brightness-90"
          >
            {t('claims.undecided.cta')}
          </Link>
        </Card>
      ) : null}

      {letters.length === 0 && sent.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="h-6 w-6" />} title={t('claims.empty')} description={t('claims.note')} />
      ) : (
        <div className="space-y-6">
          {letters.length > 0 ? <p className="text-xs text-subtle print:hidden">{t('claims.note')}</p> : null}
          <DeferredProvider undoLabel={tr('undo.cta')} secondsLabel={tr('undo.seconds')}>
            <div className="space-y-6">{letters.map(renderLetter)}</div>
          </DeferredProvider>

          {sent.length > 0 ? (
            <section aria-labelledby="sent-letters-title" className="print:hidden" data-testid="sent-letters">
              <h2 id="sent-letters-title" className="mb-2 scroll-mt-24 text-lg font-bold text-ink">
                {t('claims.sentTitle')}
              </h2>
              <p className="mb-2 text-xs text-muted">{t('claims.reminder.note')}</p>
              <Card padding="none">
                <ul className="divide-y divide-line">
                  {sent.map((s) => {
                    const left = daysLeft(s.sentAt, ANSWER_DAYS, nowIso);
                    return (
                      <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Send className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                          <span className="font-semibold text-ink">{supplierOf(s)}</span>
                          <span className="text-muted">· {formatNumber(s.count, locale)}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Badge tone={left < 0 ? 'danger' : left <= 7 ? 'warning' : 'info'}>
                            {left < 0
                              ? t('claims.sentLate', { date: formatDate(s.sentAt, locale, { day: '2-digit', month: '2-digit' }), days: formatNumber(-left, locale) })
                              : t('claims.sentBadge', { date: formatDate(s.sentAt, locale, { day: '2-digit', month: '2-digit' }), days: formatNumber(left, locale) })}
                          </Badge>
                          <span className="font-semibold tabular-nums text-ink">{ils(s.outstandingAgorot / 100)}</span>
                          {left < 0 ? (
                            // Owner decision §8.16: a DRAFT reminder to the supplier, sent only by the user's own click.
                            <a
                              href={`https://wa.me/?text=${encodeURIComponent(
                                t('claims.reminder.text', {
                                  supplier: supplierOf(s),
                                  restaurant,
                                  date: formatDate(s.sentAt, locale),
                                  count: formatNumber(s.count, locale),
                                  amount: ils(s.outstandingAgorot / 100),
                                  signer: signer || restaurant,
                                }),
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="sent-reminder"
                              className="inline-flex min-h-11 items-center rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary md:min-h-9"
                            >
                              {t('claims.reminder.cta')}
                            </a>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Link href="/dashboard/recovery" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                {t('claims.toTracker')}
              </Link>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
