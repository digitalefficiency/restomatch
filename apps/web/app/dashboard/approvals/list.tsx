'use client';

/**
 * The approvals desk (DS3-04): a thin shell over the controller (`use-desk.ts`, the desk's data and decisions) and
 * its view (`desk-view.tsx`). The data and the view stay apart, so a later package can put another view on the same
 * controller. Kept exports: `ApprovalsList` (the queue page and the `/approvals/[invoiceId]` landing),
 * `FiltersDisclosure`, and the `QueueFilters` / `QueueSummary` types.
 */
import { useMediaQuery } from '@/lib/components/desk/useMediaQuery';
import { usePrefs } from '@/lib/prefs';
import type { QueueFilters, QueueItem, QueueSummary } from './desk-types';
import { DeskView } from './desk-view';
import { NowProvider } from './queue';
import { useDesk } from './use-desk';
import { useGapDocument } from './use-gap-document';

export { FiltersDisclosure } from './filters';
export type { QueueFilters, QueueSummary } from './desk-types';

interface ApprovalsListProps {
  initial: QueueItem[];
  initialSummary: QueueSummary;
  filters?: QueueFilters;
  /** A view filter is set (the empty state then says so). */
  filtered?: boolean;
  /** The views namespace's "no rows match these filters" line. */
  filteredNote?: string;
  /** The server's `view.density`: the address `d`, else the device preference (`viewDefaults`). */
  density?: 'comfortable' | 'compact';
  /** The signed-in member's role (hides "escalate to owner" for the owner). */
  viewerRole?: string | null;
  /** `/dashboard/approvals/[invoiceId]`: one gap at a time, the narrow view at every width. */
  landing?: boolean;
  /** The server's clock for this render (#418): server HTML and hydration count days from ONE instant. */
  nowMs?: number;
}

export function ApprovalsList(props: ApprovalsListProps) {
  return (
    <NowProvider value={props.nowMs ?? null}>
      <ApprovalsDesk {...props} />
    </NowProvider>
  );
}

function ApprovalsDesk({
  initial,
  initialSummary,
  filters = {},
  filtered = false,
  filteredNote,
  density = 'comfortable',
  viewerRole = null,
  landing = false,
}: ApprovalsListProps) {
  // The two-pane desk from 1280 px (SPEC §10.2); below it, one gap at a time. Server render: wide (as before).
  const wide = useMediaQuery('(min-width: 1280px)', true);
  const mode = landing ? 'single' : 'desk';
  const c = useDesk({ initial, initialSummary, filters, viewerRole, mode, wide });
  const doc = useGapDocument(c.current, c.next);
  // What is DRAWN for single keys (caps, legend); the key handlers ask the store at every keydown.
  const { singleKeys } = usePrefs();
  return (
    <DeskView
      c={c}
      doc={doc}
      mode={mode}
      density={density === 'compact' ? 'compact' : 'regular'}
      singleKeys={singleKeys}
      wide={wide}
      filtered={filtered}
      filteredNote={filteredNote}
      viewerRole={viewerRole}
    />
  );
}
