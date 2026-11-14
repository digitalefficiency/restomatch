import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { getLocale } from '@/lib/i18n/server';
import { KitPage } from './KitPage';

export const metadata: Metadata = { title: 'Component kit · RestoMatch', robots: { index: false } };

const ROLES: readonly UserRole[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];

/**
 * The DS3 kit page (docs/ux/ds3 WORKPLAN DS3-01): every shared component of the clean finish,
 * live, in regular and compact density (`?density=compact`), with its states. Beside the token
 * lab (`lab/tokens`) and the desk lab (`lab/desk`). Platform admins only — anyone else gets a 404
 * (its existence is not advertised). Demo values only; it reads and writes nothing.
 */
export default async function KitLabPage({ searchParams }: { searchParams: Promise<{ density?: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) notFound();
  const { density } = await searchParams;
  const locale = await getLocale();
  const sessionRole = (session.user as { role?: string | null }).role ?? null;
  const role: UserRole = ROLES.includes(sessionRole as UserRole) ? (sessionRole as UserRole) : 'owner';
  return <KitPage initialDensity={density === 'compact' ? 'compact' : 'regular'} locale={locale === 'he' ? 'he' : 'en'} role={role} />;
}
