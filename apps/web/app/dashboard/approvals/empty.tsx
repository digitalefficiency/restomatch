'use client';

/**
 * The evidence panel when no gap is open (DS3-04 spec §4.7, §5.11): calm, never a false alarm. DS3-01's
 * `EmptyState` (inbox zero: the calm green chip) inside a focus target for the desk's focus chain
 * (`[data-desk-empty]`; DeskView focuses it, this view never moves focus itself).
 *
 * The title keeps today's level-2 heading (list.tsx:1422, P11e) as `<span role="heading" aria-level={2}>`:
 * `EmptyState` renders its title inside a `<p>`, where an `<h2>` would be invalid nesting (D33).
 */
import { useLocale, useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import { EmptyState } from '@/lib/components/EmptyState';
import { ilsText } from './desk-text';
import type { DeskMode, QueueSummary } from './desk-types';

type T = Translator<typeof approvalsHe>;

/** A role's name ("בעלים"), or the stored value when the catalog has none. */
function roleName(t: T, role: string): string {
  const out = t(`roles.${role}` as MessageKey<typeof approvalsHe>);
  return out.startsWith('roles.') ? role : out;
}

/**
 * "הכול מטופל" + one description, the first that applies: the filter's note when a filter is set (the landing passes
 * `desk.landingDone`); what waits for one other role; what waits for others; else "פערים חדשים יופיעו כאן". The
 * amounts are before VAT, 2 dp in the viewer's locale (ilsText, R3). Not `data-record`: it is the page's own words.
 */
export function DeskEmpty({
  summary,
  filtered,
  filteredNote,
}: {
  summary: QueueSummary;
  filtered: boolean;
  filteredNote?: string;
  /** desk | single: the same calm state in both (the landing's words arrive as `filteredNote`). */
  mode: DeskMode;
}) {
  const t = useT(approvals);
  const locale = useLocale();
  const others = summary.others;
  const single = others && others.byRole.length === 1 ? others.byRole[0]! : null;
  const description = filtered
    ? (filteredNote ?? t('empty.description'))
    : others && others.count > 0
      ? single
        ? t('empty.othersWaiting', {
            count: others.count,
            role: roleName(t, single.role),
            amount: ilsText(locale, Math.round(others.amountIls * 100)),
          })
        : t('empty.othersWaitingMany', {
            count: others.count,
            amount: ilsText(locale, Math.round(others.amountIls * 100)),
          })
      : t('empty.clearDescription');
  return (
    <div tabIndex={-1} data-desk-empty="" data-testid="approvals-empty" className="py-16">
      <EmptyState
        kind="inbox-zero"
        variant="inline"
        align="center"
        title={
          <span role="heading" aria-level={2}>
            {t('empty.title')}
          </span>
        }
        description={description}
      />
    </div>
  );
}
