import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { CountScreen } from './count-screen';

/**
 * The count itself (flag `inventoryCount`; owner / manager / chef count). Flag off ⇒ 404.
 * The bookkeeper reads closed counts only, so the count screen sends them to the list.
 * The open draft is fetched here as initial data: no SSR spinner, then fetch.
 */
export default async function InventoryCountPage() {
  const caller = await createServerCaller();
  const [{ enabled }, session] = await Promise.all([caller.inventory.enabled(), auth()]);
  if (!enabled) notFound();
  if (session?.user?.role === 'bookkeeper') redirect('/dashboard/inventory');
  const initial = await caller.inventory.current().catch(() => undefined);
  return <CountScreen viewer={{ userId: session?.user?.id ?? '', name: session?.user?.name?.trim() || null }} initial={initial} />;
}
