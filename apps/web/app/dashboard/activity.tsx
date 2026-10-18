'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { trpc } from '@/lib/trpc/client';
import { ActivityFeed, Card, LoadMore } from '@/lib/components';

type FeedItem = inferRouterOutputs<AppRouter>['activity']['feed'][number];

const PAGE = 8;

/**
 * Client wrapper around ActivityFeed with cursor "טען עוד" pagination. Seeded
 * with server-rendered `initial`; subsequent pages are fetched with the last
 * row's createdAt as the cursor.
 */
export function PaginatedActivityFeed({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState<FeedItem[]>(initial);
  // hasMore is "maybe more": true while the last fetch returned a full page.
  const [hasMore, setHasMore] = useState(initial.length >= PAGE);

  const utils = trpc.useUtils();
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const next = await utils.activity.feed.fetch({
        limit: PAGE,
        cursor: new Date(last.createdAt).toISOString(),
      });
      setItems((prev) => [...prev, ...next]);
      setHasMore(next.length >= PAGE);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card elevated padding="lg">
      <ActivityFeed items={items} />
      <LoadMore onClick={loadMore} loading={loading} hasMore={hasMore} className="mt-4" />
    </Card>
  );
}
