import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge } from '@/lib/components';
import { formatIls } from '@/lib/money';
import { SupplierTabBar } from './tab-bar';

export const dynamic = 'force-dynamic';

/**
 * Supplier-as-hub shell. Loads the supplier (404 via notFound() when missing —
 * ownership is enforced server-side in suppliers.get), renders the RTL
 * breadcrumb + header (name, active badge, real-leak ₪ figure), and the URL-
 * driven tab bar. The four tab panels render as `children` per ?tab=.
 *
 * The ₪ leak figure is the supplier's real month-excess from owner.leaks
 * (advanced_analytics-gated). When the gate is closed or there's not enough
 * data, it renders muted — never an estimate.
 */
export default async function SupplierDetailLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const caller = await createServerCaller();

  let supplier;
  try {
    supplier = await caller.suppliers.get({ supplierId: id });
  } catch (err) {
    if (err instanceof TRPCError && (err.code === 'NOT_FOUND' || err.code === 'BAD_REQUEST')) {
      notFound();
    }
    throw err;
  }

  // Real-leak ₪ for this supplier: sum monthExcessIls across its leak rows.
  // owner.leaks is advanced_analytics-gated — a closed gate (or any error) just
  // leaves the figure muted; we never fabricate a number.
  let leakIls: number | null = null;
  try {
    const leaks = await caller.owner.leaks({ limit: 100 });
    const rows = leaks.filter((l) => l.supplierId === id);
    leakIls = rows.length > 0 ? rows.reduce((sum, l) => sum + l.monthExcessIls, 0) : null;
  } catch {
    leakIls = null;
  }

  return (
    <div className="space-y-6">
      <nav aria-label="פירורי לחם" className="flex items-center gap-1 text-sm text-muted">
        <Link href="/dashboard/suppliers" className="hover:text-ink">
          ספקים
        </Link>
        <ChevronLeft className="h-4 w-4 text-subtle" aria-hidden />
        <span className="truncate font-medium text-ink">{supplier.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
              {supplier.name}
            </h1>
            <Badge tone={supplier.active ? 'accent' : 'neutral'}>
              {supplier.active ? 'פעיל' : 'לא פעיל'}
            </Badge>
            {supplier.sourcePlatform && <Badge tone="info">{supplier.sourcePlatform}</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-left">
          <p className="text-xs text-subtle">דליפה חודשית מוערכת</p>
          {leakIls != null ? (
            <p className="font-mono text-2xl font-bold tabular-nums text-warn">
              {formatIls(leakIls)}
            </p>
          ) : (
            <p className="text-sm text-subtle">אין מספיק נתונים</p>
          )}
        </div>
      </header>

      <SupplierTabBar supplierId={id} />

      <div>{children}</div>
    </div>
  );
}
