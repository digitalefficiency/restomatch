'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Check, FileScan, Loader2, Package, Scale } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mockReconcile, type ReconciliationResult } from '../_mock';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierId: string;
  onComplete: (result: ReconciliationResult) => void;
}

const STEPS = [
  { id: 'ocr', label: 'קורא את החשבונית', icon: FileScan, duration: 1100 },
  { id: 'catalog', label: 'מזהה מוצרים בקטלוג', icon: Package, duration: 900 },
  { id: 'compare', label: 'משווה להזמנה', icon: Scale, duration: 800 },
] as const;

export function Processing({ supplierId, onComplete }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(0);

  useGSAP(
    () => {
      gsap.from('.proc-step', {
        x: -20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.5,
        ease: 'power3.out',
      });
    },
    { scope: ref },
  );

  useEffect(() => {
    let cancelled = false;
    let accumulated = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let i = 0; i < STEPS.length; i += 1) {
      accumulated += STEPS[i]!.duration;
      const timer = setTimeout(() => {
        if (cancelled) return;
        setCurrentStep(i + 1);
        if (i === STEPS.length - 1) {
          setTimeout(() => {
            if (!cancelled) onComplete(mockReconcile(supplierId));
          }, 400);
        }
      }, accumulated);
      timers.push(timer);
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [supplierId, onComplete]);

  return (
    <div ref={ref} dir="rtl" className="max-w-md mx-auto py-6">
      <StepHeader
        eyebrow="צעד 3 מתוך 5"
        title="מעבד את החשבונית…"
        subtitle="זה לוקח 5-15 שניות. אנחנו מזהים פריטי-שורה ומשווים אותם להזמנה."
      />

      <div className="rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-12px_rgba(15,23,42,0.08)]">
        <div className="space-y-4">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isDone = idx < currentStep;
            const isActive = idx === currentStep;
            const isPending = idx > currentStep;

            return (
              <div
                key={step.id}
                className={`proc-step flex items-center gap-4 p-3 rounded-xl transition-all ${
                  isActive ? 'bg-blue-50/60 border border-blue-200/60' : 'bg-transparent'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                    isDone
                      ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                      : isActive
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isDone ? (
                    <Check className="w-5 h-5" strokeWidth={3} />
                  ) : isActive ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div
                    className={`font-medium ${
                      isPending ? 'text-slate-400' : 'text-slate-900'
                    }`}
                  >
                    {step.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {isDone ? 'הסתיים' : isActive ? 'מתבצע…' : 'ממתין'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>שלב {Math.min(currentStep + 1, STEPS.length)} מתוך {STEPS.length}</span>
            <span className="tabular-nums font-mono">
              {Math.round((currentStep / STEPS.length) * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-700 transition-all duration-500 ease-out"
              style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
