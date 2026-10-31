import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { TokensShowcase } from './showcase';

export const metadata: Metadata = { title: 'Design system · RestoMatch', robots: { index: false } };

const DENSITIES = ['compact', 'default', 'touch'] as const;
type Density = (typeof DENSITIES)[number];

/**
 * The living style page (W1-01): every token and v2 component, in the current
 * language, at `?density=compact|default|touch`. Platform admins only — anyone
 * else gets a 404 (its existence is not advertised).
 */
export default async function TokensLabPage({ searchParams }: { searchParams: Promise<{ density?: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) notFound();
  const { density } = await searchParams;
  const mode: Density = DENSITIES.includes(density as Density) ? (density as Density) : 'default';
  return <TokensShowcase density={mode} />;
}
