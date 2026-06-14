'use client';

import { useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { ArrowLeftRight, ShieldAlert } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, LoadMore, Textarea, type BadgeTone } from '@/lib/components';

type QueueItem = inferRouterOutputs<AppRouter>['approvals']['myQueue'][number];

const PAGE = 50;

export function ApprovalsList({ initial }: { initial: QueueItem[] }) {
  const utils = trpc.useUtils();

  // Local list seeded from the server page; cursor pagination appends older rows.
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);
  const [loadingMore, setLoadingMore] = useState(false);

  // After a decision, refetch the first page so the resolved row drops out.
  async function refreshFirstPage() {
    const fresh = await utils.approvals.myQueue.fetch({ limit: PAGE });
    setItems(fresh);
    setHasMore(fresh.length >= PAGE);
  }

  const approve = trpc.approvals.approve.useMutation({ onSuccess: refreshFirstPage });
  const reject = trpc.approvals.reject.useMutation({ onSuccess: refreshFirstPage });

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await utils.approvals.myQueue.fetch({
        limit: PAGE,
        cursor: new Date(last.createdAt).toISOString(),
      });
      setItems((prev) => [...prev, ...next]);
      setHasMore(next.length >= PAGE);
    } finally {
      setLoadingMore(false);
    }
  }

  const [activeReject, setActiveReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // At-a-glance summary above the queue: how many decisions and ₪ at risk.
  const { atRisk, blockers } = useMemo(() => {
    let sum = 0;
    let blk = 0;
    for (const d of items) {
      sum += Number(d.deltaAmount ?? 0);
      if (d.severity === 'block') blk += 1;
    }
    return { atRisk: sum, blockers: blk };
  }, [items]);

  return (
    <div className="space-y-5">
      {/* Queue summary strip — keeps the money context present while deciding. */}
      <div className="grid grid-cols-3 gap-3">
        <Card padding="sm" className="flex flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">בתור</p>
          <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-ink">
            {items.length.toLocaleString('he-IL')}
          </p>
        </Card>
        <Card padding="sm" className="flex flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">סכום בסיכון</p>
          <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-danger">
            ₪{atRisk.toLocaleString('he-IL')}
          </p>
        </Card>
        <Card padding="sm" className="flex flex-col justify-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">חוסמים</p>
          <p className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-danger">
            {blockers.toLocaleString('he-IL')}
          </p>
        </Card>
      </div>

      <div className="space-y-3">
        {items.map((d) => {
          const isBlock = d.severity === 'block';
          const isRejecting = activeReject === d.id;
          return (
            <Card
              key={d.id}
              as="article"
              elevated
              padding="none"
              className="relative overflow-hidden"
              aria-label={typeLabel(d.type)}
            >
              {/* Severity rail: leak gradient for blockers, tinted bar otherwise. */}
              <span
                aria-hidden="true"
                className={
                  isBlock
                    ? 'leak-gradient absolute inset-y-0 end-0 w-1'
                    : `absolute inset-y-0 end-0 w-1 ${railTint(d.severity)}`
                }
              />

              <div className="p-4 ps-5">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={d.severity} />
                      <h3 className="truncate text-base font-bold text-ink">{typeLabel(d.type)}</h3>
                    </div>
                    <p className="mt-1.5 flex items-baseline gap-1.5 text-sm text-muted">
                      ההפסד המוערך
                      <span className="font-mono text-lg font-extrabold tabular-nums text-danger">
                        ₪{Number(d.deltaAmount ?? 0).toLocaleString('he-IL')}
                      </span>
                    </p>
                  </div>
                  <time className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-subtle">
                    {new Date(d.createdAt).toLocaleString('he-IL')}
                  </time>
                </header>

                <WhyFlagged d={d} />

                {isRejecting ? (
                  <div className="mt-3 space-y-2 rounded-xl border border-danger/25 bg-danger/5 p-3">
                    <Textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="סיבת דחייה (חובה)"
                      rows={2}
                      aria-label="סיבת דחייה"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setActiveReject(null);
                          setRejectReason('');
                        }}
                      >
                        ביטול
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={reject.isPending}
                        disabled={!rejectReason.trim()}
                        onClick={() =>
                          reject.mutate(
                            { discrepancyId: d.id, reason: rejectReason },
                            {
                              onSuccess: () => {
                                setActiveReject(null);
                                setRejectReason('');
                              },
                            },
                          )
                        }
                      >
                        אשר דחייה
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="danger" size="sm" onClick={() => setActiveReject(d.id)}>
                      דחה
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={approve.isPending}
                      onClick={() => approve.mutate({ discrepancyId: d.id })}
                    >
                      אשר
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
        <LoadMore onClick={loadMore} loading={loadingMore} hasMore={hasMore} />
      </div>
    </div>
  );
}

/** "Why was this flagged?" — surfaces the decision record (expected vs actual,
 *  the tolerance breached, and the approval rule that routed it). */
function WhyFlagged({ d }: { d: QueueItem }) {
  const hasValues = d.expectedValue != null && d.actualValue != null;
  if (!hasValues && !d.toleranceUsed && !d.ruleName) return null;
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-subtle">
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        למה סומן?
      </div>
      {hasValues ? (
        <div className="flex items-center gap-1.5">
          <span>צפוי</span>
          <span className="font-mono font-semibold tabular-nums text-ink">{d.expectedValue}</span>
          <ArrowLeftRight className="h-3 w-3 text-subtle" aria-hidden="true" />
          <span>בפועל</span>
          <span className="font-mono font-semibold tabular-nums text-danger">{d.actualValue}</span>
        </div>
      ) : null}
      {d.toleranceUsed ? (
        <div className="mt-0.5">
          סף: <span className="font-mono tabular-nums">{d.toleranceUsed}</span>
        </div>
      ) : null}
      {d.ruleName ? <div className="mt-0.5">ניתוב: {d.ruleName}</div> : null}
    </div>
  );
}

/** Tinted severity rail color for non-blocker rows. */
function railTint(severity: string): string {
  return severity === 'warn' ? 'bg-warn/60' : 'bg-info/50';
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone: BadgeTone =
    severity === 'block' ? 'danger' : severity === 'warn' ? 'warning' : 'info';
  const label = severity === 'block' ? 'חוסם' : severity === 'warn' ? 'אזהרה' : 'מידע';
  return <Badge tone={tone}>{label}</Badge>;
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    PRICE_HIGHER: 'מחיר גבוה מהמצופה',
    PRICE_LOWER: 'מחיר נמוך מהמצופה',
    QTY_SHORT: 'חסר בכמות שהתקבלה',
    QTY_OVER: 'עודף / חיוב על יותר ממה שהתקבל',
    UNORDERED_ITEM: 'פריט בחשבונית ללא הזמנה',
    MISSING_ON_INVOICE: 'שורת הזמנה לא נמצאה בחשבונית',
    UNIT_MISMATCH: 'אי-התאמת יחידות',
    UNORDERED_ARRIVAL: 'חשבונית שהגיעה ללא הזמנה',
    DUPLICATE_INVOICE: 'חשבונית כפולה',
    DATE_ANOMALY: 'תאריך חריג',
    VAT_MISMATCH: 'אי-התאמת מע״מ',
    TOTAL_MISMATCH: 'סה״כ חשבונית לא תואם שורות',
  };
  return map[type] ?? type;
}
