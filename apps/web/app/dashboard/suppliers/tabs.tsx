'use client';

import { useState } from 'react';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { suppliers } from '@/lib/i18n/messages/suppliers';

type Tab = 'table' | 'manage' | 'scores';

/**
 * Client tab shell for the suppliers page. Both panels stay mounted (scorecards
 * is a server-rendered node passed as a prop); we toggle visibility so switching
 * tabs is instant and the entitlement-gated scorecards keep their server render.
 * The active tab is mirrored to `?view=` so a refresh/shared link keeps it.
 * Arrow keys move between tabs (WAI-ARIA tabs pattern).
 */
export function SuppliersTabs({
  management,
  scorecards,
  table,
  initialTab = 'manage',
  defaultTab = 'manage',
}: {
  management: React.ReactNode;
  scorecards: React.ReactNode;
  /** W2-11 · the vendor table (finance roles); absent → no tab. */
  table?: React.ReactNode;
  initialTab?: Tab;
  /** The tab with no `?view=` (owner: the table). */
  defaultTab?: Tab;
}) {
  const t = useT(suppliers);
  const [tab, setTab] = useState<Tab>(initialTab);
  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === defaultTab) url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const order: Tab[] = table ? ['table', 'manage', 'scores'] : ['manage', 'scores'];
      const i = order.indexOf(tab);
      // RTL: ArrowLeft moves forward (towards the inline-end).
      const forward = (e.key === 'ArrowLeft') === (document.dir === 'rtl');
      const next = order[(i + (forward ? 1 : order.length - 1)) % order.length]!;
      select(next);
      document.getElementById(`suppliers-tab-${next}`)?.focus();
    }
  };
  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label={t('tabs.label')}
        className="flex gap-1 overflow-x-auto border-b border-line"
        onKeyDown={onKeyDown}
      >
        {table ? (
          <TabButton id="table" active={tab === 'table'} onClick={() => select('table')}>
            {t('table.tab')}
          </TabButton>
        ) : null}
        <TabButton id="manage" active={tab === 'manage'} onClick={() => select('manage')}>
          {t('tabs.manage')}
        </TabButton>
        <TabButton id="scores" active={tab === 'scores'} onClick={() => select('scores')}>
          {t('tabs.scores')}
        </TabButton>
      </div>
      {table ? (
        <div role="tabpanel" id="suppliers-panel-table" aria-labelledby="suppliers-tab-table" hidden={tab !== 'table'}>
          {table}
        </div>
      ) : null}
      <div role="tabpanel" id="suppliers-panel-manage" aria-labelledby="suppliers-tab-manage" hidden={tab !== 'manage'}>
        {management}
      </div>
      <div role="tabpanel" id="suppliers-panel-scores" aria-labelledby="suppliers-tab-scores" hidden={tab !== 'scores'}>
        {scorecards}
      </div>
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  children,
}: {
  id: Tab;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`suppliers-tab-${id}`}
      aria-selected={active}
      aria-controls={`suppliers-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--c-focus))]',
        active ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
