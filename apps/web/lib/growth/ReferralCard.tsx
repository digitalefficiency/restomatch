'use client';

import { useState } from 'react';
import { Gift } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { growth } from '@/lib/i18n/messages/growth';
import { formatIls } from '@/lib/money';

type ErrKey = 'FEATURE_DISABLED' | 'invalid' | 'self' | 'already' | 'generic';

function errKey(err: unknown): ErrKey {
  const appCode = (err as { data?: { appCode?: unknown } } | null)?.data?.appCode;
  switch (appCode) {
    case 'FEATURE_DISABLED':
      return 'FEATURE_DISABLED';
    case 'growth.referralInvalid':
      return 'invalid';
    case 'growth.referralSelf':
      return 'self';
    case 'growth.referralAlreadyRedeemed':
      return 'already';
    default:
      return 'generic';
  }
}

/**
 * Referral card (wave 1, S15 — `growth`): the restaurant's own code + stats, and
 * a redeem box. Mount it on an owner/manager screen (e.g. settings or billing);
 * it renders nothing when the feature is off for the restaurant.
 */
export function ReferralCard({ canRedeem }: { canRedeem: boolean }) {
  const t = useT(growth);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const mine = trpc.growth.myReferral.useQuery(undefined, { retry: false });
  const stats = trpc.growth.referralStats.useQuery(undefined, { retry: false, enabled: mine.isSuccess });
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const redeem = trpc.growth.redeemReferral.useMutation({
    onSuccess: () => utils.growth.referralStats.invalidate(),
  });

  if (mine.error && errKey(mine.error) === 'FEATURE_DISABLED') return null;
  const ils = (agorot: number) => formatIls(agorot / 100, { locale });

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">
        <Gift className="h-4 w-4 text-gold" aria-hidden="true" />
        {t('referral.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('referral.body')}</p>

      {mine.isLoading ? <p className="mt-4 text-sm text-muted">{t('referral.loading')}</p> : null}
      {mine.data ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">{t('referral.yourCode')}</span>
          <code dir="ltr" className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-lg tracking-widest text-ink">
            {mine.data.code}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(mine.data.code).then(() => setCopied(true));
            }}
            className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:border-primary/40"
          >
            {copied ? t('referral.copied') : t('referral.copy')}
          </button>
        </div>
      ) : null}

      {stats.data ? (
        <p className="mt-3 text-sm text-muted">
          {t('referral.stats', {
            referred: formatNumber(stats.data.referred, locale),
            credited: formatNumber(stats.data.credited, locale),
          })}
          {stats.data.earnedAgorot > 0 ? ` · ${t('referral.earned', { amount: ils(stats.data.earnedAgorot) })}` : null}
        </p>
      ) : null}

      {canRedeem && stats.data && !stats.data.redeemed ? (
        <form
          className="mt-5 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            redeem.mutate({ code: input.trim() });
          }}
        >
          <label className="text-sm font-semibold text-ink" htmlFor="referral-redeem">
            {t('referral.redeemTitle')}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="referral-redeem"
              dir="ltr"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder={t('referral.redeemPlaceholder')}
              maxLength={16}
              className="min-h-[44px] flex-1 rounded-xl border border-line bg-surface-2 px-3 font-mono text-ink"
            />
            <button
              type="submit"
              disabled={redeem.isPending || input.trim().length < 6}
              className="min-h-[44px] rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-50"
            >
              {t('referral.redeem')}
            </button>
          </div>
          {redeem.error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {t(`referral.errors.${errKey(redeem.error)}`)}
            </p>
          ) : null}
        </form>
      ) : null}
      {stats.data?.redeemed ? (
        <p className="mt-4 text-sm text-primary">
          {stats.data.redeemed.status === 'credited' && stats.data.redeemed.creditAgorot !== null
            ? t('referral.redeemedCredited', { amount: ils(stats.data.redeemed.creditAgorot) })
            : t('referral.redeemed')}
        </p>
      ) : null}
    </section>
  );
}
