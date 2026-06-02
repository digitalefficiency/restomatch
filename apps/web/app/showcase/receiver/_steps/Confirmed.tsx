'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Check, ExternalLink, FileImage, Plus, Receipt, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import type { ReconciliationResult } from '../_mock';
import type { CapturedImage } from '../_state';

interface Props {
  supplierName: string;
  result: ReconciliationResult | null;
  confirmedAt: string | null;
  capturedImage: CapturedImage | null;
  onReset: () => void;
}

export function Confirmed({
  supplierName,
  result,
  confirmedAt,
  capturedImage,
  onReset,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.confirm-check', {
        scale: 0,
        opacity: 0,
        duration: 0.6,
        ease: 'back.out(2)',
      });
      gsap.from('.confirm-content', {
        y: 16,
        opacity: 0,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power3.out',
        delay: 0.2,
      });
    },
    { scope: ref },
  );

  const time = confirmedAt
    ? new Date(confirmedAt).toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div ref={ref} dir="rtl" className="max-w-md mx-auto text-center py-8">
      <div className="confirm-check w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_32px_rgba(5,150,105,0.35)]">
        <Check className="w-12 h-12 text-white" strokeWidth={3} />
      </div>

      <h1 className="confirm-content text-3xl font-bold tracking-tight text-stone-900 mb-2">
        הקבלה נסגרה
      </h1>
      <p className="confirm-content text-stone-500 mb-8">
        תועדה ב-{time} מהספק "{supplierName}". מנוע ההתאמה מריץ עכשיו את ההצלבה הסופית.
      </p>

      <div className="confirm-content rounded-2xl border border-stone-200/70 bg-white/90 backdrop-blur-xl p-5 mb-6 text-right space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.06)]">
        <RowItem
          icon={<Receipt className="w-4 h-4" />}
          label="חשבונית"
          value={result?.invoiceMeta.invoiceNumber ?? '—'}
        />
        <RowItem
          icon={<ShieldCheck className="w-4 h-4" />}
          label="פריטים שאומתו"
          value={`${result?.summary.matchedCount ?? 0} תואמים, ${
            (result?.summary.qtyDiffCount ?? 0) +
            (result?.summary.priceDiffCount ?? 0) +
            (result?.summary.unorderedCount ?? 0)
          } סודרו ידנית`}
        />
        {result && result.summary.headlineDelta > 0 ? (
          <RowItem
            icon={<Plus className="w-4 h-4" />}
            label="חיסכון פוטנציאלי שתועד"
            value={`₪${result.summary.headlineDelta.toLocaleString('he-IL')}`}
            valueClass="text-emerald-600 font-bold"
          />
        ) : null}
      </div>

      {capturedImage?.scanRouteUrl ? (
        <div className="confirm-content mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-right">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white border border-emerald-200 flex items-center justify-center shrink-0">
              <FileImage className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-emerald-900">
                החשבונית נשמרה ב-Supabase Storage
              </div>
              <div className="text-[11px] font-mono text-emerald-800/80 truncate">
                {capturedImage.invoiceId}
              </div>
            </div>
            <Link
              href={capturedImage.scanRouteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-[0_2px_8px_rgba(5,150,105,0.25)]"
            >
              צפה בסריקה
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onReset}
        className="confirm-content inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] transition-all"
      >
        <Plus className="w-4 h-4" strokeWidth={3} />
        קבלה נוספת
      </button>
    </div>
  );
}

function RowItem({
  icon,
  label,
  value,
  valueClass = 'text-stone-900 font-semibold',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span className="text-stone-400">{icon}</span>
        <span>{label}</span>
      </div>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}
