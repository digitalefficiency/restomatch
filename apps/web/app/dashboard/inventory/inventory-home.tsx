'use client';

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Badge, Button, Card, LinkButton, Spinner, friendlyError, useToast } from '@/lib/components';
import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { ils } from '../recipes/recipe-ui';
import { dayText } from './inventory-ui';
import { PeriodCard } from './period-card';

/** Start / continue a count, the period's actual food cost, and past counts with their ₪ value. */
export function InventoryHome() {
  const t = useT(inventoryNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const router = useRouter();
  const current = trpc.inventory.current.useQuery();
  const history = trpc.inventory.history.useQuery();
  const start = trpc.inventory.start.useMutation({
    onSuccess: () => router.push('/dashboard/inventory/count'),
    onError: (e) => toast.error(friendlyError(e, tc)),
  });
  const draft = current.data;

  return (
    <div className="space-y-6">
      <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm text-muted">
            {draft
              ? t('home.draftNote', { date: dayText(draft.countDate, locale), counted: draft.progress.counted, lines: draft.progress.lines })
              : t('subtitle')}
          </p>
        </div>
        {current.isLoading ? (
          <Spinner />
        ) : draft ? (
          <LinkButton href="/dashboard/inventory/count" className="touch-target">
            {t('home.continue')}
          </LinkButton>
        ) : (
          <Button className="touch-target" loading={start.isPending} onClick={() => start.mutate()}>
            {t('home.start')}
          </Button>
        )}
      </Card>

      <PeriodCard />

      <section aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 text-sm font-semibold text-muted">
          {t('home.historyTitle')}
        </h2>
        {history.isLoading ? (
          <Spinner />
        ) : (history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t('home.historyEmpty')}</p>
        ) : (
          <ul className="space-y-2" data-testid="count-history">
            {history.data!.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/dashboard/inventory/${h.id}`}
                  className="touch-target flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{dayText(h.countDate, locale)}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {t('home.items', { counted: h.counted })}
                      {h.unpriced > 0 ? <Badge tone="neutral">{t('home.unpriced', { count: h.unpriced })}</Badge> : null}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-xs text-muted">{t('home.value')}</span>
                    <bdi dir="ltr" className="font-semibold tabular-nums text-ink">
                      {ils(h.totalValueAgorot, locale, 0)}
                    </bdi>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
