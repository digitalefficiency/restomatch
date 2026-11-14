'use client';

import type { ReactNode } from 'react';
import { ExplainToggle, useDisclosure } from '@/lib/components';

/**
 * W3-07a · "תוכנית ושימוש" folds its details (W2-16 copy focus: the settings page has a
 * word budget). The summary line stays visible; usage rows open in place below it.
 */
export function PlanUsageFold({ summary, about, children }: { summary: ReactNode; about: string; children: ReactNode }) {
  const { toggleProps, panelProps } = useDisclosure('plan-usage');
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {summary}
        <ExplainToggle {...toggleProps} label="details" about={about} />
      </div>
      <div id={panelProps.id} hidden={panelProps.hidden} ref={panelProps.ref} data-explain-panel="">
        {children}
      </div>
    </>
  );
}
