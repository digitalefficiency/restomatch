/**
 * Shared invoice-paper renderer — visually modelled on real Israeli
 * "תעודת משלוח" / "חשבונית מס" documents (white paper, stylised
 * supplier logotype, classic items table, green "התקבל" stamp, hand-
 * written pen scribbles).
 *
 * Used by:
 *   - /scans/[invoiceId] page route — the standalone "scanned document"
 *     URL referenced by invoices.raw_image_url. Loaded via iframe from
 *     the scan / compare viewers.
 *
 * Pure render — no client hooks. Safe from server components.
 */

import type { ScanData, ScanLine } from './InvoiceScanViewer';

interface InvoicePaperProps {
  data: ScanData;
}

export function InvoicePaper({ data }: InvoicePaperProps) {
  const subtotal = data.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const vat = subtotal * 0.17;
  const total = subtotal + vat;

  const docType = data.documentType ?? 'delivery_note';
  const docTitle = docType === 'tax_invoice' ? 'חשבונית מס' : 'תעודת משלוח';

  const dateText = new Date(data.invoiceDate).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const timeText = new Date(data.invoiceDate).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="relative bg-white shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45),0_4px_12px_rgba(15,23,42,0.12)]"
      style={{
        width: 720,
        minHeight: 1020,
        transform: 'rotate(-0.5deg)',
        fontFamily: '"Heebo", system-ui, sans-serif',
        color: '#111827',
      }}
    >
      {/* Paper grain — vertical scanline texture as if photographed */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05] mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.4) 0, rgba(0,0,0,0.4) 1px, transparent 1px, transparent 3px)',
        }}
      />
      {/* Camera glare on the upper-left corner */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background:
            'radial-gradient(ellipse 45% 25% at 18% 8%, rgba(255,255,255,0.6), transparent 70%)',
        }}
      />
      {/* Slight yellowing along the right edge (paper age) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          background:
            'linear-gradient(270deg, rgba(245, 222, 179, 0.4) 0%, transparent 12%)',
        }}
      />

      {/* ========================================================== */}
      {/* Header band: supplier logotype (right) · date block (left) */}
      {/* ========================================================== */}
      <div className="relative px-10 pt-7 pb-2 flex items-start justify-between">
        {/* Date block — left */}
        <div className="text-[11px] leading-relaxed text-slate-700 tabular-nums shrink-0">
          <div className="flex gap-2">
            <span className="text-slate-500">תאריך:</span>
            <span className="font-semibold">{dateText}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500">שעה:</span>
            <span>{timeText}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500">דף:</span>
            <span>1 מ-1</span>
          </div>
        </div>

        {/* Supplier letterhead — right */}
        <div className="text-right">
          <div
            className="text-3xl font-black tracking-tight leading-none"
            style={{
              color: data.supplierColor,
              fontFamily: '"Heebo", "Frank Ruhl Libre", serif',
              fontStyle: 'italic',
              letterSpacing: '-0.03em',
              textShadow: '0 1px 0 rgba(0,0,0,0.05)',
            }}
          >
            {data.supplierName}
          </div>
          {data.supplierAddress ? (
            <div className="text-[10px] text-slate-600 mt-1.5 leading-tight">
              {data.supplierAddress}
            </div>
          ) : null}
          <div className="text-[10px] text-slate-600 mt-0.5">
            ח.פ. {data.supplierBusinessId}
          </div>
        </div>
      </div>

      {/* Decorative divider under header */}
      <div
        className="mx-10 border-t-2"
        style={{ borderColor: data.supplierColor }}
      />

      {/* ========================================================== */}
      {/* Title block: doc type + number, customer block               */}
      {/* ========================================================== */}
      <div className="px-10 pt-4 pb-3 flex items-start justify-between gap-6">
        {/* Customer (לכבוד) — right */}
        <div className="text-right max-w-xs">
          <div className="text-[11px] text-slate-500 mb-0.5">לכבוד:</div>
          <div className="font-bold text-sm">
            {data.customerName}
            <span className="text-slate-500 font-normal text-xs mr-1">
              ({data.customerBusinessId.slice(0, 7)})
            </span>
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            ח.פ. {data.customerBusinessId}
          </div>
          <div className="text-[11px] text-slate-600">רחוב המסעדנים 14, רעננה</div>
          <div className="text-[11px] text-slate-600">טל: 09-7711224</div>
        </div>

        {/* Title — center-left */}
        <div className="text-center pt-1">
          <div className="text-2xl font-bold tracking-tight text-slate-800">{docTitle}</div>
          <div className="text-3xl font-black tabular-nums tracking-tight mt-1">
            {data.invoiceNumber.replace(/[^0-9]/g, '') || data.invoiceNumber}
          </div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
            מקור
          </div>
        </div>
      </div>

      {/* "משלוח:" line — present on real ערן וצחי docs */}
      <div className="px-10 mb-1 text-[11px] text-slate-500">
        משלוח: ______________________
      </div>

      {/* ========================================================== */}
      {/* Items table                                                  */}
      {/* ========================================================== */}
      <div className="px-10 pt-2 pb-4">
        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr
              className="text-slate-800"
              style={{ borderBottom: '2px solid #475569' }}
            >
              <th className="px-2 py-1.5 text-right font-bold text-[11px] w-8">מ.ס.</th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px]">שם פריט</th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px] tabular-nums w-16">
                כמות
              </th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px] w-14">יחידה</th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px] tabular-nums w-20">
                מחיר
              </th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px] tabular-nums w-12">
                % הנחה
              </th>
              <th className="px-2 py-1.5 text-right font-bold text-[11px] tabular-nums w-24">
                סה״כ
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line: ScanLine, i: number) => {
              const lineTotal = line.qty * line.unitPrice;
              const hasCorrection = !!line.correction;
              return (
                <tr
                  key={i}
                  className="text-slate-900"
                  style={{ borderBottom: '1px dotted #cbd5e1' }}
                >
                  <td className="px-2 py-1.5 tabular-nums text-slate-600">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium">
                    {line.name}
                    {hasCorrection ? (
                      <span className="text-red-700 text-xs mr-2 font-semibold">⚠</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums relative">
                    <span>{line.qty.toFixed(2)}</span>
                    {line.correction ? (
                      <PenScrawl tone={line.correction.tone} className="absolute -bottom-2 right-2">
                        {line.correction.value}
                      </PenScrawl>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{line.unit}</td>
                  <td className="px-2 py-1.5 tabular-nums">{line.unitPrice.toFixed(2)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-slate-500">0.00</td>
                  <td className="px-2 py-1.5 tabular-nums font-semibold">
                    {lineTotal.toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {/* Filler rows so the table feels like a real form */}
            {Array.from({ length: Math.max(0, 8 - data.lines.length) }, (_, i) => (
              <tr key={`filler-${i}`} style={{ borderBottom: '1px dotted #e2e8f0' }}>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
                <td className="px-2 py-1.5">&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ========================================================== */}
      {/* Footer block: customer balance (right) · totals (left)       */}
      {/* ========================================================== */}
      <div className="px-10 pt-3 pb-2 flex items-start justify-between gap-8">
        {/* Customer balance — right */}
        {data.customerBalanceIls !== undefined ? (
          <div className="text-[11px] text-slate-600 max-w-[200px]">
            <div className="flex justify-between gap-3">
              <span>יתרת לקוח:</span>
              <span className="font-bold tabular-nums text-slate-900">
                {data.customerBalanceIls.toLocaleString('he-IL', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              (סוגד התשלום — לעיון)
            </div>
          </div>
        ) : (
          <div />
        )}

        {/* Totals — left */}
        <div className="text-[12px] space-y-1 min-w-[240px]">
          <TotalRow label="סה״כ לפני מע״מ" value={subtotal} />
          <TotalRow label="מע״מ 17%" value={vat} />
          <div style={{ borderTop: '2px solid #1f2937', marginTop: 4, paddingTop: 4 }}>
            <div className="flex justify-between font-black text-[14px]">
              <span>סה״כ כולל מע״מ</span>
              <span className="tabular-nums">
                {total.toLocaleString('he-IL', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================== */}
      {/* Signature lines                                              */}
      {/* ========================================================== */}
      <div className="px-10 mt-8 flex items-end justify-between gap-6 text-[10px] text-slate-500">
        <div className="flex-1 text-center">
          <div className="border-t border-slate-400 pt-1">חתימת לקוח</div>
        </div>
        <div className="flex-1 text-center">
          <div className="border-t border-slate-400 pt-1">שם המקבל</div>
        </div>
        <div className="flex-1 text-center relative">
          <div className="border-t border-slate-400 pt-1">חתימת מוסר</div>
          {data.driverSignature ? (
            <PenScrawl tone="blue" className="absolute -top-4 left-1/2 -translate-x-1/2 text-lg">
              {data.driverSignature}
            </PenScrawl>
          ) : null}
        </div>
      </div>

      {/* ========================================================== */}
      {/* Print code footer                                            */}
      {/* ========================================================== */}
      <div className="px-10 mt-8 pb-4 text-[9px] text-slate-400 tabular-nums flex justify-between">
        <span>BRW58CDC989C7B3_001364</span>
        <span>הופק במערכת RestoMatch</span>
      </div>

      {/* ========================================================== */}
      {/* Overlays: green "התקבל" stamp + handwritten order #          */}
      {/* ========================================================== */}
      <ReceivedStamp />
      <PenScrawl
        tone="blue"
        className="absolute"
        style={{
          top: 122,
          left: 32,
          fontSize: 22,
          transform: 'rotate(-4deg)',
        }}
      >
        הזמנה 218
      </PenScrawl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "התקבל" stamp — green rubber-stamp overlay (as seen on every real scan)
// ---------------------------------------------------------------------------

function ReceivedStamp() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        bottom: 130,
        left: 60,
        transform: 'rotate(-7deg)',
      }}
    >
      <div
        className="relative inline-flex items-center gap-2 px-4 py-2"
        style={{
          border: '3px solid #16a34a',
          borderRadius: 4,
          backgroundColor: 'rgba(220, 252, 231, 0.4)',
          color: '#15803d',
          fontWeight: 900,
          fontSize: 24,
          letterSpacing: '-0.02em',
          fontFamily: '"Heebo", system-ui, sans-serif',
          boxShadow: 'inset 0 0 0 1px rgba(22,163,74,0.25)',
        }}
      >
        <span style={{ fontSize: 28, lineHeight: 1 }}>✓</span>
        <span>התקבל</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-700">{label}:</span>
      <span className="font-semibold tabular-nums">
        {value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function PenScrawl({
  children,
  tone,
  className = '',
  style,
}: {
  children: React.ReactNode;
  tone: 'red' | 'blue';
  className?: string;
  style?: React.CSSProperties;
}) {
  const color = tone === 'red' ? '#b91c1c' : '#1e40af';
  return (
    <span
      className={className}
      style={{
        color,
        fontFamily: '"Caveat", "Heebo", cursive',
        fontWeight: 700,
        fontSize: '1.15em',
        transform: 'rotate(-3deg)',
        display: 'inline-block',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
