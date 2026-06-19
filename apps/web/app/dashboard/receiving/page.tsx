import Link from 'next/link';
import { ArrowLeft, Clock, PackageCheck, Truck } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Badge, Card, EmptyState, SectionHeader, type BadgeTone } from '@/lib/components';

export const dynamic = 'force-dynamic';

/** Hebrew label + tone for the (optional) in-progress goods_receipt status. */
function receiptBadge(status: string | null): { label: string; tone: BadgeTone } | null {
  if (!status) return null;
  const map: Record<string, { label: string; tone: BadgeTone }> = {
    pending: { label: 'קבלה בתהליך', tone: 'warning' },
    partial: { label: 'התקבל חלקית', tone: 'warning' },
    completed: { label: 'הקבלה נסגרה', tone: 'accent' },
  };
  return map[status] ?? { label: status, tone: 'info' };
}

export default async function ReceivingPage() {
  const caller = await createServerCaller();
  const expectations = await caller.receiving.todayExpectations();

  return (
    <div dir="rtl">
      <SectionHeader
        title="קליטת סחורה"
        subtitle="הזמנות שצפויות להגיע היום. בחר ספק כדי לצלם את החשבונית, להצליב מול ההזמנה ולקבע מה באמת הגיע."
      />

      {expectations.length === 0 ? (
        <EmptyState
          icon={<PackageCheck className="h-6 w-6" />}
          title="אין משלוחים שמתוכננים להיום"
          description="הזמנות עם תאריך אספקה היום יופיעו כאן. ברגע שספק מגיע, פתחו קבלה ותעדו את החריגות כדי לקבע את החיסכון."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {expectations.map((e) => {
            const badge = receiptBadge(e.receiptStatus);
            const expectedTime = new Date(e.expectedAt).toLocaleTimeString('he-IL', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return (
              <Link
                key={e.poId}
                href={`/dashboard/receiving/${e.poId}`}
                aria-label={`קליטה מ${e.supplierName}`}
                className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              ><Card
                elevated
                flow
                padding="md"
                className="block h-full transition-all group-hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/12 text-primary">
                      <Truck className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-ink">{e.supplierName}</h3>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span className="font-mono tabular-nums">{expectedTime}</span>
                        <span className="text-subtle">·</span>
                        <span className="font-mono tabular-nums">{e.lineCount} פריטים</span>
                      </div>
                    </div>
                  </div>
                  {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
                  <span className="text-muted">
                    {e.receiptId ? 'המשך קבלה קיימת' : 'פתח קבלה חדשה'}
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-primary">
                    קלוט סחורה
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
                  </span>
                </div>
              </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
