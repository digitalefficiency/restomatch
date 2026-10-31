import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { DeskLab } from './DeskLab';
import { LAB_VIEWS, labRows, viewTotals, type LabView } from './_data';

export const metadata = { title: 'Desk lab · RestoMatch' };

/**
 * Desk-primitives lab (W1-02): DataTable, BatchBar, ViewTabs, ExportMenu,
 * Peek and SplitPane on 500 deterministic rows. Platform admins only — the
 * page's existence is not advertised to anyone else (404).
 */
export default async function DeskLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) notFound();
  const sp = await searchParams;
  const mode = sp.mode === 'split' ? 'split' : 'table';
  const state = sp.state === 'loading' || sp.state === 'error' || sp.state === 'empty' ? sp.state : 'ready';
  const rows = labRows();
  // The "server" totals: count and Σ|Δ| over every row of each view, not the loaded page.
  const totals = Object.fromEntries(LAB_VIEWS.map((v) => [v, viewTotals(rows, v)])) as Record<
    LabView,
    { count: number; sumAgorot: number }
  >;
  return (
    <DeskLab
      totals={totals}
      mode={mode}
      labState={state}
      simulateEnforced={sp.enforced === '1'}
      failAssign={sp.fail === 'assign'}
    />
  );
}
