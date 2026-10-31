'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { overview } from '@/lib/i18n/messages/overview';

/**
 * The 15-control view toolbar hides behind one "תצוגה" chip, so the home opens
 * on the money, not on a filter form (command-06); a dot marks a non-default
 * view. The toolbar stays mounted either way (its URL state is intact).
 */
export function ViewDisclosure({ children, active }: { children: React.ReactNode; active?: boolean }) {
  const t = useT(overview);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="home-view-toolbar"
        onClick={() => setOpen((v) => !v)}
        data-testid="home-view-toggle"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {open ? t('view.close') : t('view.open')}
        {active ? <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" /> : null}
      </button>
      <div id="home-view-toolbar" hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
