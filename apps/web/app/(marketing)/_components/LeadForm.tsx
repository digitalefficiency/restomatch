'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Field, Input } from '@/lib/components';

/**
 * Lead-capture form for the marketing landing. Calls leads.create (public).
 * Includes a hidden honeypot field named `hp` — bots that fill it get a silent
 * { ok: true } with no insert (handled server-side); humans leave it empty.
 * Money is captured in shekels and converted to agorot for the contract.
 */
export function LeadForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [monthlyIls, setMonthlyIls] = useState('');
  const [hp, setHp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.leads.create.useMutation({
    onSuccess: () => {
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  if (create.isSuccess) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-2xl border border-primary/25 bg-primary/8 px-6 py-10 text-center shadow-glow-primary"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-bold text-ink">תודה! קיבלנו את הפרטים</h3>
        <p className="max-w-sm text-sm text-muted">
          נחזור אליכם בהקדם כדי לתאם הדגמה ולהראות כמה כסף RestoMatch יכולה לחסוך
          לכם כבר החודש.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const ils = Number(monthlyIls.replace(/[^\d.]/g, ''));
        const monthlyProcurementAgorot =
          Number.isFinite(ils) && ils > 0 ? Math.round(ils * 100) : undefined;
        create.mutate({
          name: name.trim(),
          phone: phone.trim() || undefined,
          restaurantName: restaurantName.trim() || undefined,
          monthlyProcurementAgorot,
          source: 'landing',
          hp: hp.trim() || undefined,
        });
      }}
      className="space-y-4"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          htmlFor="lead-name"
          label={
            <>
              שם מלא <span className="text-danger">*</span>
            </>
          }
        >
          <Input
            id="lead-name"
            required
            minLength={1}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ישראל ישראלי"
            autoComplete="name"
          />
        </Field>

        <Field htmlFor="lead-phone" label="טלפון">
          <Input
            id="lead-phone"
            type="tel"
            inputMode="tel"
            maxLength={32}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            autoComplete="tel"
          />
        </Field>

        <Field htmlFor="lead-restaurant" label="שם המסעדה">
          <Input
            id="lead-restaurant"
            maxLength={200}
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            placeholder="כפר הזיתים"
            autoComplete="organization"
          />
        </Field>

        <Field
          htmlFor="lead-procurement"
          label="רכש חודשי (₪)"
          hint="לא חובה — עוזר לנו להעריך כמה תחסכו"
        >
          <Input
            id="lead-procurement"
            inputMode="numeric"
            value={monthlyIls}
            onChange={(e) => setMonthlyIls(e.target.value)}
            placeholder="120000"
          />
        </Field>
      </div>

      {/* Honeypot — visually + a11y hidden. Bots fill it; humans never see it. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="lead-hp">אל תמלאו שדה זה</label>
        <input
          id="lead-hp"
          type="text"
          name="hp"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-r-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <Button type="submit" className="w-full" loading={create.isPending}>
        דברו איתנו
      </Button>
      <p className="text-center text-xs text-subtle">
        בלחיצה אתם מאשרים שניצור איתכם קשר. ללא ספאם.
      </p>
    </form>
  );
}
