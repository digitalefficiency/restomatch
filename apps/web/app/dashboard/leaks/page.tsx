import { TRPCError } from '@trpc/server';
import { Droplets, ShieldAlert } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import {
  Badge,
  Card,
  EmptyState,
  EntitlementUpsell,
  LeakHeatmap,
  SectionHeader,
  Sparkline,
  StatCard,
  entitlementCauseOf,
} from '@/lib/components';

export default async function LeaksPage() {
  const caller = await createServerCaller();
  let leaks: Awaited<ReturnType<typeof caller.owner.leaks>> = [];
  let blocked: 'entitlement' | 'role' | null = null;
  try {
    leaks = await caller.owner.leaks({ limit: 50 });
  } catch (err) {
    // Distinguish a missing plan feature (→ upsell) from a role restriction
    // (→ explain the role requirement). Both arrive as FORBIDDEN.
    if (entitlementCauseOf(err)) {
      blocked = 'entitlement';
    } else if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
      blocked = 'role';
    } else {
      throw err;
    }
  }

  if (blocked === 'entitlement') {
    return (
      <div>
        <SectionHeader level={1} title="בלש הדליפות" />
        <EntitlementUpsell feature="advanced_analytics" title="שדרגו את המנוי כדי לפתוח את בלש הדליפות" />
      </div>
    );
  }

  if (blocked === 'role') {
    return (
      <div>
        <SectionHeader level={1} title="בלש הדליפות" />
        <Card
          padding="md"
          className="flex items-center gap-3 border-warn/30 bg-warn/5 text-warn"
        >
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>רק לבעלי תפקיד "בעלים" יש גישה לבלש הדליפות.</span>
        </Card>
      </div>
    );
  }

  const totalExcess = leaks.reduce((sum, r) => sum + r.monthExcessIls, 0);
  const worst = leaks.reduce((m, r) => Math.max(m, r.deltaPct), 0);

  return (
    <div>
      <SectionHeader
        level={1}
        title="בלש הדליפות"
        subtitle="מוצרים שבהם המחיר האחרון חורג מהגבול ה-90 ההיסטורי."
      />

      {leaks.length === 0 ? (
        <EmptyState
          icon={<Droplets className="h-6 w-6" />}
          title="לא נמצאו דליפות פעילות"
          description="נדרשים לפחות 3 דגימות מחיר לכל ספק לפני שה-baseline מחושב. המשך לקלוט חשבוניות והדליפות יתחילו לצוף."
        />
      ) : (
        <div className="space-y-8">
          {/* At-a-glance totals — money leaking this month, in danger. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="סה״כ דליפה החודש"
              value={formatCurrency(totalExcess)}
              tone="danger"
              icon={<Droplets className="h-4 w-4" />}
              hint="עודף מצטבר מעל ה-baseline על כל המוצרים"
            />
            <StatCard
              label="מוקדי דליפה פעילים"
              value={leaks.length.toString()}
              tone="warn"
              hint="צמדי מוצר×ספק שחורגים מהגבול"
            />
            <StatCard
              label="החריגה הגבוהה ביותר"
              value={`+${(worst * 100).toFixed(0)}%`}
              tone="danger"
              hint="הקפיצה החדה ביותר מול ה-baseline"
            />
          </div>

          {/* The signature glowing heatmap. */}
          <LeakHeatmap items={leaks} />

          {/* Full breakdown table. */}
          <Card elevated padding="none" flow className="overflow-hidden">
            <table className="w-full text-sm">
              <caption className="sr-only">דליפות מחיר לפי מוצר וספק</caption>
              <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className="p-3 text-start font-semibold">מוצר</th>
                  <th scope="col" className="p-3 text-start font-semibold">ספק</th>
                  <th scope="col" className="p-3 text-start font-semibold">מחיר ממוצע</th>
                  <th scope="col" className="p-3 text-start font-semibold">מחיר אחרון</th>
                  <th scope="col" className="p-3 text-start font-semibold">שינוי</th>
                  <th scope="col" className="p-3 text-start font-semibold">מגמה</th>
                  <th scope="col" className="p-3 text-start font-semibold">הפסד צפוי</th>
                </tr>
              </thead>
              <tbody>
                {leaks.map((row) => (
                  <tr
                    key={`${row.productId}-${row.supplierId}`}
                    className="border-t border-line transition-colors hover:bg-surface-2/60"
                  >
                    <td className="p-3">
                      <div className="font-medium text-ink">{row.productName}</div>
                      <div className="text-xs text-subtle">{row.category ?? '—'}</div>
                    </td>
                    <td className="p-3 text-muted">{row.supplierName}</td>
                    <td className="p-3 font-mono tabular-nums text-muted">{formatCurrency(row.baselineP50)}</td>
                    <td className="p-3 font-mono tabular-nums text-ink">{formatCurrency(row.lastObservedPrice)}</td>
                    <td className="p-3">
                      <Badge tone={row.deltaPct >= 0.1 ? 'danger' : 'warning'}>
                        +{(row.deltaPct * 100).toFixed(1)}%
                      </Badge>
                    </td>
                    <td className="p-3">
                      <Sparkline data={row.series} />
                    </td>
                    <td className="p-3 font-mono font-semibold tabular-nums text-danger">
                      {formatCurrency(row.monthExcessIls)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

// Precise ₪ — the leak table shows the agora. Delegates to the single formatIls util.
const formatCurrency = (value: number): string => formatIls(value, { maximumFractionDigits: 2 });
