'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ArrowLeft, Check, Clock, Package } from 'lucide-react';
import { useRef } from 'react';
import { MOCK_SUPPLIERS, type MockSupplierExpectation } from '../_mock';

interface Props {
  selected: MockSupplierExpectation | null;
  onSelect: (supplier: MockSupplierExpectation) => void;
  onContinue: () => void;
}

export function SupplierSelect({ selected, onSelect, onContinue }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.supplier-card', {
        y: 24,
        opacity: 0,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power3.out',
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} dir="rtl">
      <StepHeader
        eyebrow="צעד 1 מתוך 5"
        title="איזה ספק הגיע?"
        subtitle="בחר את הספק שעומד בדלת. נטען את ההזמנה המתאימה ונשווה אליה את החשבונית."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        {MOCK_SUPPLIERS.map((s) => {
          const isSelected = selected?.supplierId === s.supplierId;
          return (
            <button
              key={s.supplierId}
              type="button"
              onClick={() => onSelect(s)}
              className={`supplier-card group relative overflow-hidden text-right rounded-2xl border p-5 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isSelected
                  ? 'border-primary/50 bg-primary/8 shadow-glow-primary'
                  : 'border-line bg-surface hover:border-primary/40 shadow-card'
              }`}
            >
              {isSelected ? (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
              ) : null}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center font-bold text-primary">
                    {s.supplierInitials}
                  </div>
                  <div>
                    <div className="font-semibold text-ink text-base">{s.supplierName}</div>
                    <div className="text-xs text-muted flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span className="font-mono tabular-nums">
                        {new Date(s.expectedAt).toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-subtle">·</span>
                      <Package className="w-3 h-3" />
                      <span className="font-mono tabular-nums">{s.totalLines} פריטים</span>
                    </div>
                  </div>
                </div>
                {isSelected ? (
                  <div className="w-7 h-7 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-glow-primary">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">
                  {s.hasActiveReceipt ? (
                    <span className="text-warn font-medium">קבלה כבר התחילה</span>
                  ) : (
                    <span>צפוי {s.poIds.length === 1 ? 'PO אחד' : `${s.poIds.length} POs`}</span>
                  )}
                </span>
                <span className="font-semibold text-ink font-mono tabular-nums">
                  ₪{s.totalEstimated.toLocaleString('he-IL')}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-sm text-muted hover:text-ink underline underline-offset-4 decoration-line"
        >
          הספק לא ברשימה?
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={onContinue}
          className="inline-flex items-center gap-2 bg-primary hover:brightness-110 disabled:bg-surface-2 disabled:text-subtle text-on-primary rounded-xl px-5 py-2.5 font-medium shadow-glow-primary disabled:shadow-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
        >
          המשך לסריקה
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function StepHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-8">
      <div className="mb-2 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
      <p className="text-xs uppercase tracking-[0.18em] text-primary font-semibold mb-2">
        {eyebrow}
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink mb-2">{title}</h1>
      {subtitle ? <p className="text-muted max-w-2xl">{subtitle}</p> : null}
    </div>
  );
}
