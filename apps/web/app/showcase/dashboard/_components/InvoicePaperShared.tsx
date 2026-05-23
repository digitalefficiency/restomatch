/**
 * Shared invoice-paper renderer. Used by:
 *   - /scans/[invoiceId] page route — the standalone "scanned document"
 *     URL that the database row points to via `rawImageUrl`.
 *   - InvoiceScanViewer and InvoicePoCompareViewer historically embedded
 *     this inline; both now load the rendered paper through an <iframe>
 *     pointing at the scans route, so this component is the single source
 *     of truth for what a scanned invoice looks like.
 *
 * Pure render — no client hooks. Safe to use from server components.
 */

import type { ScanData, ScanLine } from './InvoiceScanViewer';

interface InvoicePaperProps {
  data: ScanData;
  /** When true, draws OCR confidence rings around each extracted field. */
  showOcrOverlay?: boolean;
}

export function InvoicePaper({ data, showOcrOverlay = false }: InvoicePaperProps) {
  const subtotal = data.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const vat = subtotal * 0.17;
  const total = subtotal + vat;

  const dateText = new Date(data.invoiceDate).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div
      className="relative bg-[#fdfcf8] shadow-[0_24px_64px_-24px_rgba(15,23,42,0.35),0_4px_12px_rgba(15,23,42,0.08)] rounded-md"
      style={{
        width: 720,
        minHeight: 1020,
        transform: 'rotate(-0.4deg)',
        fontFamily: '"Heebo", system-ui, sans-serif',
      }}
    >
      {/* Subtle paper grain */}
      <div
        className="absolute inset-0 rounded-md pointer-events-none opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, rgba(0,0,0,0.4) 0, rgba(0,0,0,0.4) 1px, transparent 1px, transparent 4px)',
        }}
      />
      {/* Camera glare */}
      <div
        className="absolute inset-0 rounded-md pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 50% 30% at 80% 12%, rgba(255,255,255,0.5), transparent 70%)',
        }}
      />

      {/* Supplier header band */}
      <div
        className="rounded-t-md px-8 py-5 flex items-center justify-between"
        style={{
          background: `linear-gradient(135deg, ${data.supplierColor}, ${shade(data.supplierColor, -15)})`,
        }}
      >
        <div className="text-white">
          <div className="text-2xl font-extrabold tracking-tight">{data.supplierName}</div>
          <div className="text-xs opacity-90 mt-0.5">ח.פ. {data.supplierBusinessId}</div>
        </div>
        <div
          className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white font-bold text-xl"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {data.supplierInitials}
        </div>
      </div>

      {/* Document body */}
      <div className="px-8 pt-7 pb-10 text-slate-900 relative">
        {/* Title row */}
        <div className="flex items-start justify-between mb-7 relative">
          <h1 className="text-3xl font-bold tracking-tight">חשבונית מס</h1>
          <div className="text-left text-sm space-y-0.5">
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">מס׳ חשבונית:</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.98}>
                <span className="font-bold tabular-nums">{data.invoiceNumber}</span>
              </FieldBox>
            </div>
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">תאריך:</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.94}>
                <span className="font-medium tabular-nums">{dateText}</span>
              </FieldBox>
            </div>
          </div>
        </div>

        {/* Customer block */}
        <div className="bg-slate-50/80 rounded-lg px-5 py-3 mb-7 border border-slate-200/60">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
            לכבוד
          </div>
          <FieldBox highlight={showOcrOverlay} confidence={0.91}>
            <span className="font-bold">{data.customerName}</span>
          </FieldBox>
          <div className="text-xs text-slate-500 mt-1">ח.פ. {data.customerBusinessId}</div>
        </div>

        {/* Lines table */}
        <div className="overflow-hidden border border-slate-200 rounded-lg mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100/60 text-slate-700">
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider">
                  #
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider">
                  תיאור
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  כמות
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  מחיר ליחידה
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  סה״כ
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line: ScanLine, i: number) => (
                <tr
                  key={i}
                  className={`border-t border-slate-100 ${
                    i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                  }`}
                >
                  <td className="px-3 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <FieldBox
                      highlight={showOcrOverlay}
                      confidence={line.confidence ?? data.ocrConfidence}
                    >
                      <span className="font-medium">{line.name}</span>
                    </FieldBox>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <FieldBox
                      highlight={showOcrOverlay}
                      confidence={line.confidence ?? data.ocrConfidence}
                    >
                      {line.qty} {line.unit}
                    </FieldBox>
                    {line.correction ? (
                      <div className="mt-0.5 text-xs">
                        <PenScrawl tone={line.correction.tone}>{line.correction.value}</PenScrawl>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <FieldBox
                      highlight={showOcrOverlay}
                      confidence={line.confidence ?? data.ocrConfidence}
                    >
                      ₪{line.unitPrice.toFixed(2)}
                    </FieldBox>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold">
                    ₪{(line.qty * line.unitPrice).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-start">
          <div className="w-72 space-y-1.5 text-sm">
            <TotalRow label="סכום ביניים" value={subtotal} />
            <TotalRow label="מע״מ 17%" value={vat} />
            <div className="border-t-2 border-slate-300 my-1.5" />
            <div className="flex items-baseline justify-between bg-slate-900 text-white px-3 py-2 rounded-md">
              <span className="text-xs uppercase tracking-wider opacity-80">סה״כ לתשלום</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.99} tone="emerald">
                <span className="font-bold tabular-nums text-base">
                  ₪{total.toLocaleString('he-IL', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </FieldBox>
            </div>
          </div>
        </div>

        {/* Driver signature line */}
        <div className="mt-10 flex items-end justify-between border-t border-dashed border-slate-300 pt-4 text-xs text-slate-500">
          <div>
            <div>תנאי תשלום: שוטף +30</div>
            <div className="mt-0.5">חתימת נהג:</div>
            {data.driverSignature ? (
              <PenScrawl tone="blue" className="text-base mt-1">
                {data.driverSignature}
              </PenScrawl>
            ) : (
              <div className="w-32 border-b border-slate-400 mt-3" />
            )}
          </div>
          <div className="text-right opacity-70">
            תודה רבה ויום נעים!
            <br />
            {data.supplierName}
          </div>
        </div>
      </div>

      {/* Tape / corner sticker */}
      <div
        className="absolute -top-1 right-12 w-16 h-6 bg-gradient-to-b from-amber-200/70 to-amber-300/70 rounded-sm shadow-sm"
        style={{ transform: 'rotate(-3deg)' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function FieldBox({
  children,
  highlight,
  confidence = 1,
  tone = 'blue',
}: {
  children: React.ReactNode;
  highlight: boolean;
  confidence?: number;
  tone?: 'blue' | 'emerald';
}) {
  if (!highlight) return <>{children}</>;
  const color =
    tone === 'emerald'
      ? confidence > 0.9
        ? 'ring-emerald-400 bg-emerald-50/60'
        : confidence > 0.75
          ? 'ring-amber-400 bg-amber-50/60'
          : 'ring-red-400 bg-red-50/60'
      : confidence > 0.9
        ? 'ring-blue-400 bg-blue-50/50'
        : confidence > 0.75
          ? 'ring-amber-400 bg-amber-50/60'
          : 'ring-red-400 bg-red-50/60';
  return (
    <span
      className={`relative inline-block px-1 rounded ring-2 ring-offset-1 ring-offset-transparent ${color}`}
      title={`OCR confidence: ${Math.round(confidence * 100)}%`}
    >
      {children}
    </span>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium tabular-nums">
        ₪{value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function PenScrawl({
  children,
  tone,
  className = '',
}: {
  children: React.ReactNode;
  tone: 'red' | 'blue';
  className?: string;
}) {
  const color = tone === 'red' ? 'text-red-600' : 'text-blue-700';
  return (
    <span
      className={`${color} ${className}`}
      style={{
        fontFamily: '"Caveat", "Heebo", cursive',
        fontSize: '1.05em',
        transform: 'rotate(-2deg)',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

function shade(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
