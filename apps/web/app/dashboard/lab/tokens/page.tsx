import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { TokensShowcase } from './showcase';
import { DraftsLab } from './_drafts/DraftsLab';

export const metadata: Metadata = { title: 'Design system · RestoMatch', robots: { index: false } };

const DENSITIES = ['compact', 'default', 'touch'] as const;
type Density = (typeof DENSITIES)[number];

/**
 * The living style page (W1-01): every token and v2 component, in the current
 * language, at `?density=compact|default|touch`. Platform admins only — anyone
 * else gets a 404 (its existence is not advertised). `?view=drafts` is the
 * W2-15 drafts lab (lib/drafts + PrintButton); it lives here so the nav
 * registry needs no new route.
 */
export default async function TokensLabPage({ searchParams }: { searchParams: Promise<{ density?: string; view?: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) notFound();
  const { density, view } = await searchParams;
  if (view === 'drafts') {
    const restaurantId = session.user.restaurantId ?? '';
    return <DraftsLab scope={restaurantId ? { userId: session.user.id, restaurantId } : null} />;
  }
  const mode: Density = DENSITIES.includes(density as Density) ? (density as Density) : 'default';
  return <TokensShowcase density={mode} />;
}
