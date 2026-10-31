'use client';

import { useState } from 'react';
import { BellRing, Mail, MessageCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { recovery } from '@/lib/i18n/messages/recovery';
import { Card } from '@/lib/components';

/**
 * Owner decision 16: an overdue reminder to a SUPPLIER is a per-supplier
 * DRAFT ("תזכורת לספק · 3 דרישות · ₪451.00"). The draft only builds the
 * wa.me / mailto link; the user's own click opens it. Nothing is sent
 * automatically and the server stamps nothing (recovery.reminderDraft reads).
 */
export function ReminderDrafts({ suppliers }: { suppliers: Array<{ supplierId: string; name: string }> }) {
  const t = useT(recovery);
  if (suppliers.length === 0) return null;
  return (
    <Card padding="md" data-testid="reminder-drafts">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
        <BellRing className="h-4 w-4 text-warn" aria-hidden="true" />
        {t('reminder.title')}
      </h2>
      <p className="mt-0.5 text-xs text-muted">{t('reminder.hint')}</p>
      <ul className="mt-2 divide-y divide-line/60">
        {suppliers.map((s) => (
          <ReminderRow key={s.supplierId} supplierId={s.supplierId} name={s.name} />
        ))}
      </ul>
    </Card>
  );
}

function ReminderRow({ supplierId, name }: { supplierId: string; name: string }) {
  const t = useT(recovery);
  const locale = useLocale();
  const [why, setWhy] = useState(false);
  const draft = trpc.recovery.reminderDraft.useQuery({ supplierId }, { staleTime: 60_000 });
  const d = draft.data;
  if (!d || d.count === 0) return null;
  const amount = formatIls(d.outstandingAgorot / 100, { locale, maximumFractionDigits: 2 });
  const count = formatNumber(d.count, locale);
  const body = t('reminder.body', { supplier: name, count, amount, days: formatNumber(d.oldestDays, locale) });
  const subject = t('reminder.subject', { count, amount });
  const phone = d.whatsapp?.replace(/[^\d]/g, '') ?? '';
  const wa = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
  const mail = `mailto:${encodeURIComponent(d.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const link =
    'inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:border-primary/40 hover:text-primary md:min-h-9';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="reminder-draft">
      <p className="text-sm text-ink">
        {t('reminder.line', { supplier: name, count })} · <bdi className="font-semibold tabular-nums">{amount}</bdi>{' '}
        <button
          type="button"
          className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
          aria-expanded={why}
          onClick={() => setWhy((v) => !v)}
        >
          {t('reminder.why')}
        </button>
        {why ? <span className="mt-1 block text-xs text-muted">{t('reminder.whyText', { days: formatNumber(d.oldestDays, locale) })}</span> : null}
      </p>
      <span className="flex gap-2">
        <a href={wa} target="_blank" rel="noopener noreferrer" className={link} data-testid="reminder-whatsapp">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {t('reminder.whatsapp')}
        </a>
        <a href={mail} className={link} data-testid="reminder-mail">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {t('reminder.mail')}
        </a>
      </span>
    </li>
  );
}
