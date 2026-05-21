'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';

type QueueItem = inferRouterOutputs<AppRouter>['approvals']['myQueue'][number];

export function ApprovalsList({ initial }: { initial: QueueItem[] }) {
  const utils = trpc.useUtils();
  const queue = trpc.approvals.myQueue.useQuery(undefined, { initialData: initial });
  const approve = trpc.approvals.approve.useMutation({
    onSuccess: () => utils.approvals.myQueue.invalidate(),
  });
  const reject = trpc.approvals.reject.useMutation({
    onSuccess: () => utils.approvals.myQueue.invalidate(),
  });

  const [activeReject, setActiveReject] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  return (
    <div className="space-y-3">
      {queue.data?.map((d) => (
        <article
          key={d.id}
          className="rounded-xl border border-neutral-800 bg-surface p-5"
        >
          <header className="flex items-start justify-between gap-3 mb-3">
            <div>
              <SeverityBadge severity={d.severity} />
              <h3 className="text-lg font-semibold mt-2">{typeLabel(d.type)}</h3>
              <p className="text-sm text-neutral-400 mt-1">
                ההפסד המוערך:{' '}
                <span className="font-semibold text-white">
                  ₪{Number(d.deltaAmount ?? 0).toLocaleString('he-IL')}
                </span>
              </p>
            </div>
            <div className="text-xs text-neutral-500 whitespace-nowrap">
              {new Date(d.createdAt).toLocaleString('he-IL')}
            </div>
          </header>

          {activeReject === d.id ? (
            <div className="space-y-2">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="סיבת דחייה (חובה)"
                rows={2}
                className="w-full rounded-md bg-bg border border-neutral-700 px-3 py-2 text-sm focus:border-primary outline-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setActiveReject(null);
                    setRejectReason('');
                  }}
                  className="text-xs text-neutral-400 px-3 py-1.5 hover:text-white"
                >
                  ביטול
                </button>
                <button
                  disabled={!rejectReason.trim() || reject.isPending}
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
                  className="text-xs bg-danger hover:bg-danger/80 disabled:opacity-50 px-3 py-1.5 rounded-md font-medium"
                >
                  אשר דחייה
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setActiveReject(d.id)}
                className="text-sm text-danger border border-danger/30 hover:bg-danger/10 px-3 py-1.5 rounded-md"
              >
                דחה
              </button>
              <button
                disabled={approve.isPending}
                onClick={() => approve.mutate({ discrepancyId: d.id })}
                className="text-sm bg-accent hover:bg-accent/80 text-bg disabled:opacity-50 px-3 py-1.5 rounded-md font-medium"
              >
                אשר
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === 'block'
      ? 'bg-danger/15 text-danger'
      : severity === 'warn'
        ? 'bg-warning/15 text-warning'
        : 'bg-neutral-800 text-neutral-300';
  const label = severity === 'block' ? 'חמור' : severity === 'warn' ? 'בינוני' : 'מידע';
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${tone}`}>{label}</span>
  );
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
