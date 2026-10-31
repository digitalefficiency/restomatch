import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { InventoryHome } from './inventory-home';

/**
 * Inventory counting → actual food cost (flag `inventoryCount`). Owner /
 * manager / chef (lib/roles.ts); the chef counts but sees no ₪. A restaurant without the flag gets a 404 —
 * the feature is invisible, not "locked".
 */
export default async function InventoryPage() {
  const caller = await createServerCaller();
  const [{ enabled }, session] = await Promise.all([caller.inventory.enabled(), auth()]);
  if (!enabled) notFound();
  const t = await getT(inventoryNs);
  // Owner decision: the chef sees no ₪ — no period card, no count values
  // (the server sends none to the chef either).
  const showMoney = session?.user?.role !== 'chef';
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <InventoryHome showMoney={showMoney} />
    </div>
  );
}
