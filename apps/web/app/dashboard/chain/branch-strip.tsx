import { createServerCaller } from '@/lib/trpc/server';
import { formatIls } from '@/lib/money';
import { formatNumber } from '@/lib/i18n/format';
import { getLocale, getT } from '@/lib/i18n/server';
import { originalProps } from '@/lib/i18n/original';
import { chain } from '@/lib/i18n/messages/chain';
import { Badge, Card, cn } from '@/lib/components';
import { SwitchBranchButton } from './switch-button';

/**
 * W3-01 slice b · the "סניף" strip: one row per branch of the caller's chain
 * scope, with that branch's own figure for this screen (`chain.byBranch`, each
 * row read under its branch's RLS with the single-branch reader). Shown only to
 * an owner or bookkeeper of a chain with 2+ branches; everywhere else it renders
 * nothing. Acting stays in the row's own branch: "עבדו כסניף הזה" lands on the
 * same screen there (`then`).
 */
type Kind = 'approvals' | 'payRun';

export async function BranchStrip({ kind, then }: { kind: Kind; then: string }) {
  const caller = await createServerCaller();
  const data = await caller.chain.byBranch({ kind }).catch(() => null);
  if (!data || data.rows.length < 2) return null;
  const [t, locale] = await Promise.all([getT(chain), getLocale()]);
  const ils = (v: number) => formatIls(v, { locale });

  return (
    <Card padding="sm" className="mb-4" data-testid={`branch-strip-${kind}`}>
      <h2 className="mb-2 text-xs font-semibold text-subtle">{t('strip.title')}</h2>
      <ul className="divide-y divide-line">
        {data.rows.map((r) => (
          <li
            key={r.restaurantId}
            className={cn('flex flex-wrap items-center justify-between gap-2 py-2', r.isActive && 'bg-info/12 -mx-2 rounded-lg px-2')}
            data-testid="branch-strip-row"
            data-branch={r.restaurantId}
          >
            <span className="min-w-0 break-words font-semibold text-ink" {...originalProps(r.name)}>
              {r.name}
              {r.isActive ? (
                <Badge tone="info" className="ms-2">
                  {t('strip.active')}
                </Badge>
              ) : null}
            </span>
            <span className="flex items-center gap-3">
              {r.status === 'error' ? (
                <span className="text-sm text-muted">{t('strip.error')}</span>
              ) : kind === 'approvals' && r.approvals ? (
                <span className="font-mono text-sm tabular-nums text-ink">
                  {t('strip.approvals', {
                    count: formatNumber(r.approvals.toDecideCount, locale),
                    amount: ils(r.approvals.toDecideIls),
                  })}
                </span>
              ) : kind === 'payRun' && r.payRun ? (
                r.payRun.enabled ? (
                  <span className="font-mono text-sm tabular-nums text-ink">
                    {t('strip.payRun', { pay: ils(r.payRun.payIls), hold: ils(r.payRun.holdIls) })}
                  </span>
                ) : (
                  <span className="text-sm text-muted">{t('strip.off')}</span>
                )
              ) : null}
              {!r.isActive ? (
                <SwitchBranchButton restaurantId={r.restaurantId} branchName={r.name} then={then} variant="ghost" />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {data.totals.partial ? <p className="mt-2 text-xs text-muted">{t('strip.partial')}</p> : null}
    </Card>
  );
}
