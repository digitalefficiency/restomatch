'use client';

import { useState } from 'react';
import { cn } from '@/lib/components';

type Tab = 'manage' | 'scores';

/**
 * Client tab shell for the suppliers page. Both panels stay mounted (scorecards
 * is a server-rendered node passed as a prop); we toggle visibility so switching
 * tabs is instant and the entitlement-gated scorecards keep their server render.
 */
export function SuppliersTabs({
  management,
  scorecards,
}: {
  management: React.ReactNode;
  scorecards: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('manage');
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="תצוגת ספקים" className="flex gap-1 border-b border-line">
        <TabButton active={tab === 'manage'} onClick={() => setTab('manage')}>
          ניהול ספקים
        </TabButton>
        <TabButton active={tab === 'scores'} onClick={() => setTab('scores')}>
          דירוג ספקים
        </TabButton>
      </div>
      <div hidden={tab !== 'manage'}>{management}</div>
      <div hidden={tab !== 'scores'}>{scorecards}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
