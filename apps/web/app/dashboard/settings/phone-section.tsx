'use client';

import { useState } from 'react';
import { Button, Card, Field, Input, StatusChip } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { trpc } from '@/lib/trpc/client';

/**
 * The caller's own mobile number (W2-14, profile phone). Interim until G-03's
 * `users.phone_verified_at` is deployed and a WhatsApp/SMS provider exists: the
 * number is stored normalised (+972…) and shown "לא מאומת"; no code is sent.
 */
export function PhoneSection({ initial }: { initial: string | null }) {
  const t = useT(settings);
  const [value, setValue] = useState(initial ?? '');
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setMyPhone = trpc.settings.setMyPhone.useMutation({
    onSuccess: (res) => {
      setSaved(res.phone);
      setValue(res.phone ?? '');
      setMsg({ ok: true, text: res.phone ? t('phone.saved') : t('phone.cleared') });
    },
    onError: () => setMsg({ ok: false, text: t('phone.failed') }),
  });

  return (
    <Card flow elevated padding="lg" className="space-y-3">
      <p className="text-sm text-muted">{t('phone.hint')}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          setMyPhone.mutate({ phone: value.trim() || null });
        }}
      >
        <Field label={t('phone.label')} htmlFor="my-phone" className="min-w-0 flex-1 sm:max-w-xs">
          <Input
            id="my-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="050-1234567"
          />
        </Field>
        <Button type="submit" disabled={setMyPhone.isPending || value.trim() === (saved ?? '')}>
          {t('phone.save')}
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            disabled={setMyPhone.isPending}
            onClick={() => {
              setMsg(null);
              setMyPhone.mutate({ phone: null });
            }}
          >
            {t('phone.clear')}
          </Button>
        ) : null}
      </form>
      {saved ? <StatusChip tone="neutral" label={t('phone.unverified')} /> : null}
      {msg ? (
        <p role="status" className={`text-sm ${msg.ok ? 'text-primary' : 'text-danger'}`}>
          {msg.text}
        </p>
      ) : null}
    </Card>
  );
}
