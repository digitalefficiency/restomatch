'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/components';
import { DateTime } from '@/lib/components/money';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { trpc } from '@/lib/trpc/client';
import type { HistoryRow } from '../_rules/RulesForm';

/** The server's maximum (settings.history); both sections ask for the same rows. */
const HISTORY_LIMIT = 100;
const FIELDS = ['name', 'businessId', 'vatRate', 'timezone'] as const;
type ProfileField = (typeof FIELDS)[number];
const LABEL_KEY: Record<ProfileField, string> = {
  name: 'profile.name',
  businessId: 'profile.businessId',
  vatRate: 'profile.vat',
  timezone: 'profile.timezone',
};

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A template's `{name}` placeholders replaced by React nodes (names, dates): the text stays in the catalog. */
function fill(template: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/).map((piece, i) => {
    const m = /^\{([a-zA-Z]+)\}$/.exec(piece);
    return m && m[1]! in parts ? <span key={i}>{parts[m[1]!]}</span> : <span key={i}>{piece}</span>;
  });
}

/** One stored value as the form shows it: the VAT rate in percent (the label says %), tenant text isolated. */
function ValueText({ t, field, value }: { t: T; field: ProfileField; value: unknown }) {
  if (value === null || value === undefined || value === '') return <span>—</span>;
  if (field === 'vatRate') {
    const pct = Math.round(Number(value) * 1000) / 10;
    return <bdi dir="ltr">{Number.isFinite(pct) ? String(pct) : '—'}</bdi>;
  }
  if (field === 'timezone' && value === 'Asia/Jerusalem')
    return <span>{t('profile.timezoneIsrael')}</span>;
  return <bdi>{String(value)}</bdi>;
}

/**
 * Who changed the restaurant's details (name, ח״פ, VAT rate, time zone), when,
 * and from what to what: the `settings.profile_updated` audit rows, read-only.
 * The wording is the rules history's ("שונה לאחרונה", "היסטוריית שינויים").
 */
export function ProfileHistory({ initial }: { initial: HistoryRow[] }) {
  const t = useT(settings) as unknown as T;
  const [open, setOpen] = useState(false);
  const query = trpc.settings.history.useQuery({ limit: HISTORY_LIMIT }, { initialData: initial });
  const all = query.data ?? initial;
  const rows = all.filter((h) => h.kind === 'profile');
  /** The server returned its maximum: older changes may exist, so the count is not the total. */
  const capped = all.length >= HISTORY_LIMIT;
  const last = rows[0];
  const changeTemplate = t('thresholds.history.change');

  return (
    <div className="mt-4 space-y-1" data-testid="profile-history">
      {last ? (
        <p className="text-caption text-muted">
          {fill(t('thresholds.history.last'), {
            name: (
              <bdi className="text-ink">{last.byName ?? t('thresholds.history.unknownUser')}</bdi>
            ),
            when: <DateTime value={last.at} variant="datetime" className="text-ink" />,
          })}
        </p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="profile-history-list"
        onClick={() => setOpen((o) => !o)}
        className="-ms-2 inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-caption font-medium text-muted hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:min-h-11"
      >
        {capped
          ? t('thresholds.history.toggleLatest')
          : t('thresholds.history.toggle', { n: rows.length })}
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-short', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <ul id="profile-history-list" hidden={!open} className="space-y-2">
        {rows.length === 0 ? (
          <li className="text-caption text-muted">{t('thresholds.history.empty')}</li>
        ) : null}
        {rows.map((row) => {
          const before = row.before ?? {};
          const after = row.after ?? {};
          const changed = FIELDS.filter(
            (f) => f in after && String(before[f] ?? '') !== String(after[f] ?? ''),
          );
          return (
            <li
              key={row.id}
              className="grid gap-x-3 text-caption text-muted sm:grid-cols-[auto_auto_minmax(0,1fr)]"
            >
              <DateTime value={row.at} variant="datetime" className="text-ink" />
              <bdi>{row.byName ?? t('thresholds.history.unknownUser')}</bdi>
              <span>
                {changed.length === 0
                  ? t('thresholds.history.noChange')
                  : changed.map((f, j) => (
                      <span key={f}>
                        {j > 0 ? ', ' : null}
                        {fill(changeTemplate, {
                          field: t(LABEL_KEY[f]),
                          from: <ValueText t={t} field={f} value={before[f]} />,
                          to: <ValueText t={t} field={f} value={after[f]} />,
                        })}
                      </span>
                    ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
