'use client';

import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Check, ClipboardList, FileText, PackageCheck, RotateCcw, TriangleAlert } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { landing } from '@/lib/i18n/messages/landing';
import { formatIls } from '@/lib/money';
import { cn } from '@/lib/components/cn';

gsap.registerPlugin(useGSAP);

type Status = 'ok' | 'price' | 'short' | 'unordered';

/**
 * Illustrative invoice (labelled as such in the UI). Leak = Σ |delta|:
 *   chicken  30 kg × (34.50 − 32.00) = ₪75
 *   olive oil 2 tins short × ₪89    = ₪178
 *   mozzarella 3 kg × ₪53 unordered = ₪159
 *   total                            = ₪412
 */
const ROWS: {
  key: 'item1' | 'item2' | 'item3' | 'item4';
  unit: 'unitKg' | 'unitPcs';
  ordered: number | null;
  received: number;
  invoiced: number;
  status: Status;
  delta: number;
}[] = [
  { key: 'item1', unit: 'unitKg', ordered: 20, received: 20, invoiced: 20, status: 'ok', delta: 0 },
  { key: 'item2', unit: 'unitKg', ordered: 30, received: 30, invoiced: 30, status: 'price', delta: 75 },
  { key: 'item3', unit: 'unitPcs', ordered: 6, received: 4, invoiced: 6, status: 'short', delta: 178 },
  { key: 'item4', unit: 'unitKg', ordered: null, received: 3, invoiced: 3, status: 'unordered', delta: 159 },
];
const TOTAL = ROWS.reduce((s, r) => s + r.delta, 0);

const STATUS_LABEL = {
  ok: 'visual.statusOk',
  price: 'visual.statusPrice',
  short: 'visual.statusShort',
  unordered: 'visual.statusUnordered',
} as const;

/**
 * Hero product visual — the "matching moment": the three documents light up,
 * a scan beam walks the invoice line by line, each line resolves to a match or
 * a priced discrepancy, and the card lands on the ₪ caught before payment.
 *
 * SSR renders the FINAL state (so no-JS, reduced-motion users and crawlers see
 * the full story); the timeline only runs client-side when motion is allowed.
 */
export function HeroMatch() {
  const t = useT(landing);
  const locale = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root);
        const total = q('[data-total]')[0] as HTMLElement | undefined;
        const counter = { v: 0 };
        const timeline = gsap.timeline({ repeat: -1, repeatDelay: 4.5, defaults: { ease: 'power2.out' } });
        timeline
          .set(q('[data-status]'), { autoAlpha: 0, scale: 0.85 })
          .set(q('[data-row]'), { autoAlpha: 0.35 })
          .set(q('[data-doc]'), { autoAlpha: 0.35 })
          .set(q('[data-link]'), { scaleX: 0 })
          .set(q('[data-totalcard]'), { autoAlpha: 0, y: 14 })
          .set(q('[data-beam]'), { autoAlpha: 0, yPercent: 0 })
          .to(q('[data-doc]'), { autoAlpha: 1, duration: 0.45, stagger: 0.35 })
          .to(q('[data-link]'), { scaleX: 1, duration: 0.5, stagger: 0.35 }, '<0.2');
        q('[data-row]').forEach((row, i) => {
          timeline
            .set(q('[data-beam]'), { autoAlpha: 1, top: (row as HTMLElement).offsetTop, height: (row as HTMLElement).offsetHeight })
            .to(row, { autoAlpha: 1, duration: 0.3 }, i === 0 ? '+=0.15' : '+=0.05')
            .to(q(`[data-status="${i}"]`), { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, '+=0.25');
        });
        timeline
          .to(q('[data-beam]'), { autoAlpha: 0, duration: 0.3 })
          .to(q('[data-totalcard]'), { autoAlpha: 1, y: 0, duration: 0.5 }, '<')
          .fromTo(
            counter,
            { v: 0 },
            {
              v: TOTAL,
              duration: 1.1,
              ease: 'power3.out',
              onUpdate: () => {
                if (total) total.textContent = formatIls(Math.round(counter.v), { locale });
              },
            },
            '<0.1',
          );
        tl.current = timeline;
        return () => {
          tl.current = null;
        };
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [locale] },
  );

  const docs = [
    { icon: ClipboardList, label: t('visual.docPo') },
    { icon: PackageCheck, label: t('visual.docGr') },
    { icon: FileText, label: t('visual.docInv') },
  ];

  return (
    <figure ref={root} className="relative mx-auto w-full max-w-xl">
      <div aria-hidden="true" className="glow-primary-blob pointer-events-none absolute -inset-10 rounded-full blur-3xl" />
      <div
        role="img"
        aria-label={t('visual.label')}
        className="relative overflow-hidden rounded-3xl border border-line bg-surface/90 shadow-card backdrop-blur"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />

        {/* Three documents, linked */}
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-3 sm:gap-2 sm:px-5">
          {docs.map((d, i) => {
            const Icon = d.icon;
            return (
              <div key={d.label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
                <span
                  data-doc
                  className="flex min-w-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary sm:text-xs"
                >
                  <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden="true" />
                  <span className="truncate">{d.label}</span>
                  <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                </span>
                {i < docs.length - 1 ? (
                  <span
                    data-link
                    className="h-px flex-1 origin-left bg-gradient-to-r from-primary/70 to-primary/20 rtl:origin-right rtl:bg-gradient-to-l"
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Invoice header */}
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-5">
          <p className="text-sm font-bold text-ink">{t('visual.invoiceTitle')}</p>
          <p className="truncate text-xs text-subtle">{t('visual.supplier')}</p>
        </div>

        {/* Lines */}
        <div className="relative px-2 pb-3 pt-2 sm:px-3">
          <span
            data-beam
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 top-0 rounded-xl border border-primary/40 bg-primary/[0.06] opacity-0 shadow-glow-primary sm:inset-x-3"
          />
          <div className="grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-x-2 px-2 pb-1.5 text-[11px] text-subtle ltr:font-mono ltr:text-[10px] ltr:uppercase ltr:tracking-wider sm:text-xs ltr:sm:text-[11px]">
            <span>{t('visual.colItem')}</span>
            <span className="text-center">{t('visual.colOrdered')}</span>
            <span className="text-center">{t('visual.colReceived')}</span>
            <span className="text-center">{t('visual.colInvoiced')}</span>
            <span className="w-[4.75rem] text-end sm:w-24" />
          </div>
          <ul className="space-y-1">
            {ROWS.map((r, i) => {
              const bad = r.status !== 'ok';
              const qty = (n: number | null) => (n === null ? t('visual.notOrdered') : t(`visual.${r.unit}`, { n }));
              return (
                <li
                  key={r.key}
                  data-row
                  className="relative grid grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto] items-center gap-x-2 rounded-xl px-2 py-2.5 text-xs sm:text-sm"
                >
                  <span className="font-medium leading-tight text-ink">{t(`visual.${r.key}`)}</span>
                  <span className={cn('text-center font-mono text-[11px] tabular-nums sm:text-sm', r.ordered === null ? 'text-danger' : 'text-muted')}>
                    {qty(r.ordered)}
                  </span>
                  <span className={cn('text-center font-mono text-[11px] tabular-nums sm:text-sm', r.status === 'short' ? 'text-danger' : 'text-muted')}>
                    {qty(r.received)}
                  </span>
                  <span className="text-center font-mono text-[11px] tabular-nums text-muted sm:text-sm">{qty(r.invoiced)}</span>
                  <span
                    data-status={i}
                    className={cn(
                      'inline-flex w-[4.75rem] items-center justify-end gap-1 text-end text-[11px] font-semibold sm:w-24 sm:text-xs',
                      bad ? 'text-danger' : 'text-primary',
                    )}
                  >
                    {bad ? (
                      <span className="flex flex-col items-end leading-tight">
                        <span className="inline-flex items-center gap-1">
                          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                          {t(STATUS_LABEL[r.status])}
                        </span>
                        <span className="font-mono tabular-nums">{formatIls(r.delta, { locale })}</span>
                      </span>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {t(STATUS_LABEL[r.status])}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The ₪ landing */}
        <div
          data-totalcard
          className="relative m-3 mt-0 overflow-hidden rounded-2xl border border-danger/30 bg-danger/[0.08] p-4 shadow-glow-danger sm:m-4 sm:mt-0"
        >
          <span aria-hidden="true" className="absolute inset-y-0 start-0 w-0.5 leak-gradient" />
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-danger">{t('visual.totalLabel')}</p>
              <p className="mt-1 text-xs text-muted">{t('visual.totalSub')}</p>
            </div>
            <p
              data-total
              className="font-mono text-3xl font-extrabold tabular-nums tracking-tight text-danger drop-shadow-glow-danger sm:text-4xl"
            >
              {formatIls(TOTAL, { locale })}
            </p>
          </div>
        </div>
      </div>

      <figcaption className="relative mt-3 flex items-center justify-between px-1 text-[11px] text-subtle">
        <span className="rounded-full border border-line bg-surface-2/70 px-2 py-0.5 font-medium">
          {t('visual.illustrative')}
        </span>
        <button
          type="button"
          onClick={() => tl.current?.restart()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-subtle transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:hidden"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {t('visual.replay')}
        </button>
      </figcaption>
    </figure>
  );
}
