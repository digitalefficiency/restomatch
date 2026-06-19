'use client';

/**
 * Showcase — delivery tracking & manager alerts (Feature #3).
 *
 * Per-supplier expected delivery + editable cutoff time. When "now" passes the
 * cutoff on the expected day and the goods haven't been marked arrived, the row
 * becomes LATE and surfaces a manager alert with next actions: call the agent
 * (tel:), WhatsApp the agent (wa.me), or mark handled.
 *
 * Demo uses client-side state; the production trigger is a Vercel Cron hitting a
 * check route that writes to notifications_outbox — same UX, server-driven.
 */

import { AlertTriangle, CheckCircle2, Clock, Phone, MessageCircle, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface Delivery {
  id: string;
  supplierName: string;
  agentName: string;
  agentPhone: string; // primary, Israeli format, e.g. 050-8994012
  secondaryPhone?: string; // demoted-but-kept previous number
  orderedOn: string; // human label
  expectedLabel: string; // human label, e.g. "היום"
  cutoff: string; // "HH:MM" — editable
  arrived: boolean;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Israeli local number → wa.me international (972). */
function toIntl(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
}

export default function DeliveriesPage() {
  // Seed cutoffs relative to "now" so the demo always shows one late + one
  // pending regardless of view time. Computed once on mount.
  const [now, setNow] = useState<Date | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [handled, setHandled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const t = new Date();
    setNow(t);
    const past = new Date(t.getTime() - 90 * 60_000); // 90 min ago → LATE
    const future = new Date(t.getTime() + 150 * 60_000); // in 2.5h → pending
    setDeliveries([
      {
        id: 'd1',
        supplierName: 'ירקני אבי',
        agentName: 'דני לוי',
        agentPhone: '052-7341288',
        secondaryPhone: '050-7341288', // demo: a kept-secondary number (previous agent line)
        orderedOn: 'אתמול 16:40',
        expectedLabel: 'היום',
        cutoff: hhmm(past),
        arrived: false,
      },
      {
        id: 'd2',
        supplierName: 'פאנדנגו איסוף ומחזור',
        agentName: 'שי כרמי',
        agentPhone: '050-8994012',
        orderedOn: 'היום 08:15',
        expectedLabel: 'היום',
        cutoff: hhmm(future),
        arrived: false,
      },
      {
        id: 'd3',
        supplierName: 'קצביית הכרם',
        agentName: 'מאיר אזולאי',
        agentPhone: '054-6620913',
        orderedOn: 'אתמול 11:00',
        expectedLabel: 'היום',
        cutoff: '09:00',
        arrived: true,
      },
    ]);
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  function statusOf(d: Delivery): 'arrived' | 'pending' | 'late' {
    if (d.arrived || handled[d.id]) return 'arrived';
    if (!now) return 'pending';
    const [h, m] = d.cutoff.split(':').map(Number);
    const deadline = new Date(now);
    deadline.setHours(h ?? 0, m ?? 0, 0, 0);
    return now.getTime() > deadline.getTime() ? 'late' : 'pending';
  }

  const lateCount = useMemo(
    () => deliveries.filter((d) => statusOf(d) === 'late').length,
    [deliveries, now, handled],
  );

  return (
    <div dir="rtl" className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-1">
        <Truck className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold text-ink">מעקב אספקות</h1>
      </div>
      <p className="text-muted text-sm mb-6">
        הגדר שעת-יעד לכל ספק. אם הסחורה לא הגיעה עד השעה — קופצת התראה עם פעולות מיידיות.
      </p>

      {lateCount > 0 ? (
        <div className="mb-6 rounded-2xl border border-danger/40 bg-danger/8 p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-danger shrink-0" />
          <div>
            <div className="font-semibold text-ink">{lateCount} אספקות באיחור</div>
            <div className="text-sm text-muted">סחורה שאמורה הייתה להגיע ועברה שעת היעד — נדרשת פעולה.</div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {deliveries.map((d) => {
          const status = statusOf(d);
          const intl = toIntl(d.agentPhone);
          const waText = encodeURIComponent(
            `שלום ${d.agentName}, ההזמנה מ"${d.supplierName}" (${d.orderedOn}) שאמורה הייתה להגיע ${d.expectedLabel} טרם הגיעה. מתי היא תגיע?`,
          );
          return (
            <div
              key={d.id}
              className={`rounded-2xl border p-4 shadow-card transition-colors ${
                status === 'late'
                  ? 'border-danger/40 bg-danger/5'
                  : status === 'arrived'
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-line bg-surface'
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{d.supplierName}</span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-sm text-muted mt-1">
                    סוכן: {d.agentName} · {d.agentPhone} · הוזמן {d.orderedOn} · צפי: {d.expectedLabel}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted shrink-0">
                  <Clock className="w-4 h-4" />
                  שעת יעד
                  <input
                    type="time"
                    value={d.cutoff}
                    onChange={(e) =>
                      setDeliveries((prev) =>
                        prev.map((x) => (x.id === d.id ? { ...x, cutoff: e.target.value } : x)),
                      )
                    }
                    className="bg-surface-2 border border-line rounded-lg px-2 py-1 text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  />
                </label>
              </div>

              {status === 'late' && !handled[d.id] ? (
                <div className="mt-4 pt-4 border-t border-danger/20">
                  <div className="text-sm font-medium text-danger mb-3">
                    ⚠️ לא הגיעה עד {d.cutoff}. צעדים אפשריים:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`tel:${d.agentPhone.replace(/\D/g, '')}`}
                      className="inline-flex items-center gap-2 bg-primary text-on-primary rounded-xl px-4 py-2 text-sm font-medium hover:brightness-110 shadow-glow-primary transition-all"
                    >
                      <Phone className="w-4 h-4" />
                      התקשר לסוכן
                    </a>
                    {d.secondaryPhone ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted px-1">
                          <MessageCircle className="w-4 h-4" /> שלח WhatsApp ל:
                        </span>
                        <a
                          href={`https://wa.me/${intl}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          ראשי · {d.agentPhone}
                        </a>
                        <a
                          href={`https://wa.me/${toIntl(d.secondaryPhone)}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          משני · {d.secondaryPhone}
                        </a>
                        <button
                          onClick={() => {
                            window.open(`https://wa.me/${intl}?text=${waText}`, '_blank');
                            window.open(`https://wa.me/${toIntl(d.secondaryPhone!)}?text=${waText}`, '_blank');
                          }}
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          שניהם
                        </button>
                      </>
                    ) : (
                      <a
                        href={`https://wa.me/${intl}?text=${waText}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-surface-2 border border-line text-ink rounded-xl px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                      >
                        <MessageCircle className="w-4 h-4" />
                        שלח WhatsApp
                      </a>
                    )}
                    <button
                      onClick={() => setHandled((h) => ({ ...h, [d.id]: true }))}
                      className="inline-flex items-center gap-2 bg-surface-2 border border-line text-muted rounded-xl px-4 py-2 text-sm font-medium hover:text-ink transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      סמן כטופל
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-subtle mt-8">
        בפרודקשן: Vercel Cron מריץ בדיקה בשעת-היעד מול ההזמנות וקולט תעודות משלוח; התראה נכתבת
        ל-notifications_outbox ונשלחת למנהל (push/WhatsApp). כאן מודגם ה-UX בצד-לקוח.
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: 'arrived' | 'pending' | 'late' }) {
  if (status === 'late')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 text-danger text-xs font-semibold px-2 py-0.5">
        <AlertTriangle className="w-3 h-3" /> באיחור
      </span>
    );
  if (status === 'arrived')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-xs font-semibold px-2 py-0.5">
        <CheckCircle2 className="w-3 h-3" /> הגיעה
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 text-muted text-xs font-semibold px-2 py-0.5">
      <Clock className="w-3 h-3" /> ממתינה
    </span>
  );
}
