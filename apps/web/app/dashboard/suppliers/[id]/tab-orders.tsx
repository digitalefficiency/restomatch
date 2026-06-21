import Link from 'next/link';
import { Plus, ShoppingCart } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Button, Card, EmptyState, type BadgeTone } from '@/lib/components';
import { formatIls } from '@/lib/money';

type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';

const STATUS: Record<PoStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'טיוטה', tone: 'neutral' },
  sent: { label: 'נשלחה', tone: 'info' },
  confirmed: { label: 'אושרה', tone: 'accent' },
  partial: { label: 'חלקית', tone: 'warning' },
  closed: { label: 'נסגרה', tone: 'neutral' },
  cancelled: { label: 'בוטלה', tone: 'danger' },
};

/**
 * Orders tab — this supplier's purchase orders (orders.list filtered by
 * supplierId): date + status + estimated total. Empty → first-order CTA.
 */
export async function SupplierOrdersTab({ supplierId }: { supplierId: string }) {
  const caller = await createServerCaller();
  const orders = await caller.orders.list({ supplierId, limit: 50 });

  const newOrderHref = `/dashboard/orders/new?supplierId=${supplierId}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={newOrderHref}>
          <Button variant="primary" size="sm">
            <Plus className="h-4 w-4" /> הזמנה חדשה לספק
          </Button>
        </Link>
      </div>

      {orders.length === 0 ? (
        <Card elevated>
          <EmptyState
            icon={<ShoppingCart className="h-6 w-6" />}
            title="עוד לא בוצעו הזמנות לספק הזה"
            description="צרו את ההזמנה הראשונה מתוך מחירון הספק — והיא תוצלב אוטומטית מול החשבונית שתתקבל."
            action={
              <Link href={newOrderHref}>
                <Button variant="primary" size="sm">
                  הזמנה ראשונה
                </Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card elevated padding="none" className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-subtle">
                <th className="px-4 py-3 font-medium">תאריך</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">אספקה צפויה</th>
                <th className="px-4 py-3 font-medium">שורות</th>
                <th className="px-4 py-3 font-medium">סכום משוער</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const st = STATUS[o.status as PoStatus] ?? STATUS.draft;
                return (
                  <tr key={o.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3 text-muted">
                      {new Date(o.createdAt).toLocaleDateString('he-IL')}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {o.expectedDeliveryAt
                        ? new Date(o.expectedDeliveryAt).toLocaleDateString('he-IL')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{o.lineCount}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-ink">
                      {o.totalEstimated != null ? formatIls(Number(o.totalEstimated)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
