import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { CountScreen } from './count-screen';

/** The count itself (flag `inventoryCount`; owner / manager / chef — lib/roles.ts). Flag off ⇒ 404. */
export default async function InventoryCountPage() {
  const caller = await createServerCaller();
  const { enabled } = await caller.inventory.enabled();
  if (!enabled) notFound();
  return <CountScreen />;
}
