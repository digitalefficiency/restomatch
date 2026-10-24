import { notFound } from 'next/navigation';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { InventoryHome } from './inventory-home';

/**
 * Inventory counting → actual food cost (flag `inventoryCount`). Owner /
 * manager / chef (lib/roles.ts). A restaurant without the flag gets a 404 —
 * the feature is invisible, not "locked".
 */
export default async function InventoryPage() {
  const caller = await createServerCaller();
  const { enabled } = await caller.inventory.enabled();
  if (!enabled) notFound();
  const t = await getT(inventoryNs);
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <InventoryHome />
    </div>
  );
}
