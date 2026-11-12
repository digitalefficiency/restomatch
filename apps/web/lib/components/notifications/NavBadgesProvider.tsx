'use client';

import { createContext, useContext, useMemo } from 'react';
import { trpc } from '@/lib/trpc/client';
import { routeBadgeMap } from '@/lib/nav/badges';
import { toRouteBadges, type NavBadges } from './model';

const Ctx = createContext<NavBadges>({});
// Cast like the other providers: two @types/react copies (see lib/i18n/client.tsx).
const Provider = Ctx.Provider as unknown as React.ComponentType<{ value: NavBadges; children: React.ReactNode }>;

const ROUTE_MAP = routeBadgeMap();

/**
 * Nav badges (W2-08 §5.3): ONE `nav.badges` request feeds the sidebar, the rail
 * dot, the bottom bar and the "עוד" sheet. Fresh for 30 s, refetched on focus
 * and every 60 s. Until it answers (or if it fails) there is no badge: a badge
 * is never a guess, and 0 is hidden anyway.
 */
export function NavBadgesProvider({ children }: { children: React.ReactNode }) {
  const q = trpc.nav.badges.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const value = useMemo(() => toRouteBadges(q.data?.badges, ROUTE_MAP), [q.data]);
  return <Provider value={value}>{children}</Provider>;
}

export function useNavBadges(): NavBadges {
  return useContext(Ctx);
}
