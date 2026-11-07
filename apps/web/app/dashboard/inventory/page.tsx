import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';
import { InventoryHome, type InventoryRole } from './inventory-home';

/**
 * Inventory counting → actual food cost (flag `inventoryCount`). Owner / manager /
 * chef count; the bookkeeper reads (owner decision). The chef sees no ₪ — the
 * server sends none. A restaurant without the flag gets a 404. `current` and
 * `history` are fetched here as initial data (no SSR spinner, then fetch).
 */
export default async function InventoryPage() {
  const caller = await createServerCaller();
  const [{ enabled }, session] = await Promise.all([caller.inventory.enabled(), auth()]);
  if (!enabled) notFound();
  const t = await getT(inventoryNs);
  const role = (session?.user?.role ?? 'chef') as InventoryRole;
  const [initialCurrent, initialHistory] = await Promise.all([
    role === 'bookkeeper' ? Promise.resolve(undefined) : caller.inventory.current().catch(() => undefined),
    caller.inventory.history().catch(() => undefined),
  ]);
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <InventoryHome role={role} initialCurrent={initialCurrent} initialHistory={initialHistory} />
    </div>
  );
}
