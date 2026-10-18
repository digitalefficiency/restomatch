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
import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { showcase } from '@/lib/i18n/messages/showcase';
import { mockText } from '../_lib/mockText';

interface Delivery {
  id: string;
  supplierName: string;
  agentName: string;
  agentPhone: string; // primary, Israeli format, e.g. 050-8994012
  secondaryPhone?: string; // demoted-but-kept previous number
  orderedDay: 'today' | 'yesterday';
  orderedTime: string; // "HH:MM"
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
  const t = useT(showcase);
  const locale = useLocale();
  // Seed cutoffs relative to "now" so the demo always shows one late + one
  // pending regardless of view time. Computed once on mount.
  const [now, setNow] = useState<Date | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [handled, setHandled] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const start = new Date();
    setNow(start);
    const past = new Date(start.getTime() - 90 * 60_000); // 90 min ago → LATE
    const future = new Date(start.getTime() + 150 * 60_000); // in 2.5h → pending
    setDeliveries([
      {
        id: 'd1',
        supplierName: 'ירקני אבי',
        agentName: 'דני לוי',
        agentPhone: '052-7341288',
        secondaryPhone: '050-7341288', // demo: a kept-secondary number (previous agent line)
        orderedDay: 'yesterday',
        orderedTime: '16:40',
        cutoff: hhmm(past),
        arrived: false,
      },
      {
        id: 'd2',
        supplierName: 'פאנדנגו איסוף ומחזור',
        agentName: 'שי כרמי',
        agentPhone: '050-8994012',
        orderedDay: 'today',
        orderedTime: '08:15',
        cutoff: hhmm(future),
        arrived: false,
      },
      {
        id: 'd3',
        supplierName: 'קצביית הכרם',
        agentName: 'מאיר אזולאי',
        agentPhone: '054-6620913',
        orderedDay: 'yesterday',
        orderedTime: '11:00',
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

  // A handful of rows — computed per render (statusOf reads now + handled).
  const lateCount = deliveries.filter((d) => statusOf(d) === 'late').length;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
      <div className="flex items-center gap-3 mb-1">
        <Truck className="w-6 h-6 text-primary" />
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">{t('deliveries.title')}</h1>
      </div>
      <p className="text-muted text-sm mb-6 max-w-2xl">{t('deliveries.lead')}</p>

      {lateCount > 0 ? (
        <div className="mb-6 rounded-2xl border border-danger/40 bg-danger/8 p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-danger shrink-0" />
          <div>
            <div className="font-semibold text-ink">
              {lateCount === 1 ? t('deliveries.lateOne') : t('deliveries.lateMany', { count: lateCount })}
            </div>
            <div className="text-sm text-muted">{t('deliveries.lateBody')}</div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {deliveries.map((d) => {
          const status = statusOf(d);
          const intl = toIntl(d.agentPhone);
          const supplierName = mockText(d.supplierName, locale);
          const agentName = mockText(d.agentName, locale);
          const orderedOn = t(d.orderedDay === 'today' ? 'deliveries.todayAt' : 'deliveries.yesterdayAt', {
            time: d.orderedTime,
          });
          const expected = t('deliveries.today');
          const waText = encodeURIComponent(
            t('deliveries.waMessage', {
              agent: agentName,
              supplier: supplierName,
              ordered: orderedOn,
              expected,
            }),
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
                    <span className="font-semibold text-ink">{supplierName}</span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-sm text-muted mt-1">
                    {t('deliveries.meta', {
                      agent: agentName,
                      phone: d.agentPhone,
                      ordered: orderedOn,
                      expected,
                    })}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted shrink-0">
                  <Clock className="w-4 h-4" />
                  {t('deliveries.cutoff')}
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
                    ⚠️ {t('deliveries.notArrived', { time: d.cutoff })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`tel:${d.agentPhone.replace(/\D/g, '')}`}
                      className="inline-flex items-center gap-2 bg-primary text-on-primary rounded-xl px-4 py-2 text-sm font-medium hover:brightness-110 shadow-glow-primary transition-all"
                    >
                      <Phone className="w-4 h-4" />
                      {t('deliveries.call')}
                    </a>
                    {d.secondaryPhone ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted px-1">
                          <MessageCircle className="w-4 h-4" /> {t('deliveries.whatsappTo')}
                        </span>
                        <a
                          href={`https://wa.me/${intl}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          {t('deliveries.primary')} · <span dir="ltr">{d.agentPhone}</span>
                        </a>
                        <a
                          href={`https://wa.me/${toIntl(d.secondaryPhone)}?text=${waText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          {t('deliveries.secondary')} · <span dir="ltr">{d.secondaryPhone}</span>
                        </a>
                        <button
                          onClick={() => {
                            window.open(`https://wa.me/${intl}?text=${waText}`, '_blank');
                            window.open(`https://wa.me/${toIntl(d.secondaryPhone!)}?text=${waText}`, '_blank');
                          }}
                          className="inline-flex items-center gap-1 bg-surface-2 border border-line text-ink rounded-xl px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary transition-all"
                        >
                          {t('deliveries.both')}
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
                        {t('deliveries.whatsapp')}
                      </a>
                    )}
                    <button
                      onClick={() => setHandled((h) => ({ ...h, [d.id]: true }))}
                      className="inline-flex items-center gap-2 bg-surface-2 border border-line text-muted rounded-xl px-4 py-2 text-sm font-medium hover:text-ink transition-all"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {t('deliveries.markHandled')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted mt-8 max-w-2xl leading-relaxed">{t('deliveries.footnote')}</p>
    </main>
  );
}

function StatusBadge({ status }: { status: 'arrived' | 'pending' | 'late' }) {
  const t = useT(showcase);
  if (status === 'late')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 text-danger text-xs font-semibold px-2 py-0.5">
        <AlertTriangle className="w-3 h-3" /> {t('deliveries.status.late')}
      </span>
    );
  if (status === 'arrived')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-xs font-semibold px-2 py-0.5">
        <CheckCircle2 className="w-3 h-3" /> {t('deliveries.status.arrived')}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 text-muted text-xs font-semibold px-2 py-0.5">
      <Clock className="w-3 h-3" /> {t('deliveries.status.pending')}
    </span>
  );
}
