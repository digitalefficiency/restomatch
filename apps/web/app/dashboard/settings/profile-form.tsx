'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input } from '@/lib/components';

type Profile = inferRouterOutputs<AppRouter>['settings']['profile'];

export function ProfileForm({ initial, canEdit }: { initial: Profile; canEdit: boolean }) {
  const [name, setName] = useState(initial.name);
  const [businessId, setBusinessId] = useState(initial.businessId ?? '');
  // VAT is stored as a fraction (0.18) but edited as a whole percent (18).
  const [vat, setVat] = useState(String(Math.round(initial.vatRate * 1000) / 10));
  const [timezone, setTimezone] = useState(initial.timezone);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.settings.updateProfile.useMutation({
    onSuccess: () => setStatus({ ok: true, message: 'פרטי המסעדה נשמרו.' }),
    onError: (err) => setStatus({ ok: false, message: err.message || 'שמירת הפרטים נכשלה.' }),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const vatNum = Number(vat.trim());
    update.mutate({
      name: name.trim(),
      businessId: businessId.trim() || null,
      ...(Number.isFinite(vatNum) ? { vatRate: vatNum / 100 } : {}),
      timezone: timezone.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!canEdit ? (
        <Card padding="md" className="flex items-center gap-3 border-warn/30 bg-warn/5 text-muted">
          <Lock className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span>תצוגה בלבד — רק לבעלי תפקיד "בעלים" יש הרשאה לעדכן את פרטי המסעדה.</span>
        </Card>
      ) : null}

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">פרטי המסעדה</h3>
        <p className="mb-5 text-sm text-muted">
          שיעור המע״מ ואזור הזמן משפיעים ישירות על חישוב הדליפה וגבולות היום — ודאו שהם נכונים.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="שם המסעדה" htmlFor="prof-name">
            <Input
              id="prof-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              required
              minLength={1}
              maxLength={200}
            />
          </Field>
          <Field label="ח״פ / עוסק מורשה" htmlFor="prof-biz">
            <Input
              id="prof-biz"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              disabled={!canEdit}
              inputMode="numeric"
              maxLength={32}
              placeholder="514778123"
            />
          </Field>
          <Field label="שיעור מע״מ (%)" htmlFor="prof-vat" hint="ברירת מחדל 18% (שיעור המע״מ בישראל מ-2025).">
            <Input
              id="prof-vat"
              type="number"
              inputMode="decimal"
              value={vat}
              onChange={(e) => setVat(e.target.value)}
              disabled={!canEdit}
              step="0.1"
              min="0"
              max="100"
            />
          </Field>
          <Field label="אזור זמן" htmlFor="prof-tz" hint="לדוגמה: Asia/Jerusalem">
            <Input
              id="prof-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!canEdit}
              maxLength={64}
              placeholder="Asia/Jerusalem"
            />
          </Field>
        </div>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" loading={update.isPending}>
            שמור פרטים
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
