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
              className={`supplier-card group relative text-right rounded-2xl border p-5 transition-all duration-200 ${
                isSelected
                  ? 'border-teal-400 bg-teal-50/40 shadow-[0_2px_8px_rgba(37,99,235,0.12),0_12px_32px_-8px_rgba(37,99,235,0.18)]'
                  : 'border-stone-200/70 bg-white/90 hover:border-teal-300 hover:bg-teal-50/20 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-100 to-teal-50 border border-teal-200/70 flex items-center justify-center font-bold text-teal-700">
                    {s.supplierInitials}
                  </div>
                  <div>
                    <div className="font-semibold text-stone-900 text-base">{s.supplierName}</div>
                    <div className="text-xs text-stone-500 flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span className="tabular-nums">
                        {new Date(s.expectedAt).toLocaleTimeString('he-IL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="text-stone-300">·</span>
                      <Package className="w-3 h-3" />
                      <span className="tabular-nums">{s.totalLines} פריטים</span>
                    </div>
                  </div>
                </div>
                {isSelected ? (
                  <div className="w-7 h-7 rounded-full bg-teal-600 text-white flex items-center justify-center shadow-[0_2px_4px_rgba(37,99,235,0.3)]">
                    <Check className="w-4 h-4" strokeWidth={3} />
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-500">
                  {s.hasActiveReceipt ? (
                    <span className="text-amber-600 font-medium">קבלה כבר התחילה</span>
                  ) : (
                    <span>צפוי {s.poIds.length === 1 ? 'PO אחד' : `${s.poIds.length} POs`}</span>
                  )}
                </span>
                <span className="font-semibold text-stone-700 tabular-nums">
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
          className="text-sm text-stone-500 hover:text-stone-800 underline underline-offset-4 decoration-stone-300"
        >
          הספק לא ברשימה?
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={onContinue}
          className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-stone-200 disabled:text-stone-400 text-white rounded-xl px-5 py-2.5 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] disabled:shadow-none transition-all"
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
      <p className="text-xs uppercase tracking-[0.18em] text-teal-600 font-semibold mb-2">
        {eyebrow}
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-stone-900 mb-2">{title}</h1>
      {subtitle ? <p className="text-stone-500 max-w-2xl">{subtitle}</p> : null}
    </div>
  );
}
