'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, Textarea, type BadgeTone } from '@/lib/components';

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
        <Card key={d.id} as="article" elevated aria-label={typeLabel(d.type)}>
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <SeverityBadge severity={d.severity} />
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{typeLabel(d.type)}</h3>
              <p className="mt-1 text-sm text-slate-500">
                ההפסד המוערך:{' '}
                <span className="font-semibold text-slate-900">
                  ₪{Number(d.deltaAmount ?? 0).toLocaleString('he-IL')}
                </span>
              </p>
            </div>
            <div className="whitespace-nowrap text-xs text-slate-500">
              {new Date(d.createdAt).toLocaleString('he-IL')}
            </div>
          </header>

          {activeReject === d.id ? (
            <div className="space-y-2">
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
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setActiveReject(d.id)}
              >
                דחה
              </Button>
              <Button
                variant="accent"
                size="sm"
                loading={approve.isPending}
                onClick={() => approve.mutate({ discrepancyId: d.id })}
              >
                אשר
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone: BadgeTone =
    severity === 'block' ? 'danger' : severity === 'warn' ? 'warning' : 'neutral';
  const label = severity === 'block' ? 'חמור' : severity === 'warn' ? 'בינוני' : 'מידע';
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
