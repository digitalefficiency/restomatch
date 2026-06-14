'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input } from '@/lib/components';

type Settings = inferRouterOutputs<AppRouter>['settings']['get'];

/** Field descriptor: how a numeric setting maps to a UI input. */
type FieldKind = 'percent' | 'currency' | 'fraction';

interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  kind: FieldKind;
}

const TOLERANCE_FIELDS: FieldDef[] = [
  { key: 'pricePercent', label: 'סבילות מחיר (%)', kind: 'percent', hint: 'חריגת מחיר שמתחתיה לא מסומן.' },
  { key: 'priceAbsolute', label: 'סבילות מחיר (₪)', kind: 'currency', hint: 'הפרש מחיר מוחלט שמתחתיו לא מסומן.' },
  { key: 'qtyPercent', label: 'סבילות כמות (%)', kind: 'percent' },
  { key: 'qtyAbsolute', label: 'סבילות כמות (יחידות)', kind: 'currency' },
  { key: 'blockPricePercent', label: 'סף חסימת מחיר (%)', kind: 'percent', hint: 'חריגה מעל סף זה נחסמת אוטומטית.' },
];

const APPROVAL_FIELDS: FieldDef[] = [
  { key: 'largeInvoiceWithoutPo', label: 'חשבונית גדולה ללא הזמנה (₪)', kind: 'currency' },
  { key: 'unorderedItemSignificant', label: 'פריט לא מוזמן מהותי (₪)', kind: 'currency' },
  { key: 'cumulativeLargeAmount', label: 'סכום מצטבר גבוה (₪)', kind: 'currency' },
  { key: 'cumulativeLargePct', label: 'אחוז מצטבר גבוה (%)', kind: 'percent' },
  { key: 'cumulativeMediumAmountMin', label: 'סכום מצטבר בינוני — מינ׳ (₪)', kind: 'currency' },
  { key: 'cumulativeMediumPctMin', label: 'אחוז מצטבר בינוני — מינ׳ (%)', kind: 'percent' },
];

// Percent fields are stored 0..1 but edited as whole percents (5 = 0.05).
function toDisplay(value: number | undefined, kind: FieldKind): string {
  if (value == null) return '';
  if (kind === 'percent') return String(Math.round(value * 1000) / 10);
  return String(value);
}

function toStored(raw: string, kind: FieldKind): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return kind === 'percent' ? n / 100 : n;
}

export function SettingsForm({ initial, canEdit }: { initial: Settings; canEdit: boolean }) {
  // One flat string-state map keyed by field key (sections share no keys).
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of TOLERANCE_FIELDS) {
      out[f.key] = toDisplay(initial.tolerances?.[f.key as keyof typeof initial.tolerances], f.kind);
    }
    for (const f of APPROVAL_FIELDS) {
      out[f.key] = toDisplay(
        initial.approvalThresholds?.[f.key as keyof typeof initial.approvalThresholds],
        f.kind,
      );
    }
    return out;
  });
  const [ocr, setOcr] = useState<string>(toDisplay(initial.ocrReviewThreshold, 'percent'));

  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.settings.update.useMutation({
    onSuccess: () => setStatus({ ok: true, message: 'ההגדרות נשמרו.' }),
    onError: (err) => setStatus({ ok: false, message: err.message || 'שמירת ההגדרות נכשלה.' }),
  });

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const tolerances: Record<string, number> = {};
    for (const f of TOLERANCE_FIELDS) {
      const v = toStored(values[f.key] ?? '', f.kind);
      if (v != null) tolerances[f.key] = v;
    }
    const approvalThresholds: Record<string, number> = {};
    for (const f of APPROVAL_FIELDS) {
      const v = toStored(values[f.key] ?? '', f.kind);
      if (v != null) approvalThresholds[f.key] = v;
    }
    const ocrReviewThreshold = toStored(ocr, 'percent');

    update.mutate({
      ...(Object.keys(tolerances).length ? { tolerances } : {}),
      ...(Object.keys(approvalThresholds).length ? { approvalThresholds } : {}),
      ...(ocrReviewThreshold != null ? { ocrReviewThreshold } : {}),
    });
  }

  const inputProps = (kind: FieldKind) =>
    kind === 'percent' ? { step: '0.1', min: '0', max: '100' } : { step: 'any', min: '0' };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!canEdit ? (
        <Card
          padding="md"
          className="flex items-center gap-3 border-warn/30 bg-warn/5 text-muted"
        >
          <Lock className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span>תצוגה בלבד — רק לבעלי תפקיד "בעלים" יש הרשאה לעדכן את הגדרות ההתאמה.</span>
        </Card>
      ) : null}

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">ספי סבילות</h3>
        <p className="mb-5 text-sm text-muted">
          אחוזים מוזנים כמספר שלם (5 = 5%). שדה ריק משאיר את הערך הקיים ללא שינוי.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TOLERANCE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`set-${f.key}`} hint={f.hint}>
              <Input
                id={`set-${f.key}`}
                type="number"
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={!canEdit}
                {...inputProps(f.kind)}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">ספי אישור</h3>
        <p className="mb-5 text-sm text-muted">
          הסכומים שמכתיבים מתי חריגה מנותבת לתור האישורים לפי גודלה.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {APPROVAL_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`set-${f.key}`} hint={f.hint}>
              <Input
                id={`set-${f.key}`}
                type="number"
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                disabled={!canEdit}
                {...inputProps(f.kind)}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">סף בדיקת OCR</h3>
        <p className="mb-5 text-sm text-muted">
          רמת ביטחון שמתחתיה חשבונית סרוקה נשלחת לבדיקה ידנית (5 = 5%).
        </p>
        <Field label="סף בדיקה (%)" htmlFor="set-ocr" className="max-w-xs">
          <Input
            id="set-ocr"
            type="number"
            inputMode="decimal"
            value={ocr}
            onChange={(e) => setOcr(e.target.value)}
            disabled={!canEdit}
            step="0.1"
            min="0"
            max="100"
          />
        </Field>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" loading={update.isPending}>
            שמור הגדרות
          </Button>
          {status ? (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-sm font-medium ${
                status.ok ? 'text-primary' : 'text-danger'
              }`}
            >
              {status.ok ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4" aria-hidden="true" />
              )}
              {status.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
