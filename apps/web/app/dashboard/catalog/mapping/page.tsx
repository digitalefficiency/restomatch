import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { SkuMapper } from './mapper';

/**
 * Catalog mapping queue — supplier SKUs (מק״ט) that arrived on an imported order
 * or an OCR'd invoice but aren't yet linked to a product. Linking one teaches
 * the system, backfills the already-imported lines, and makes every future
 * order/invoice from that supplier resolve automatically.
 */
export default async function CatalogMappingPage() {
  const caller = await createServerCaller();
  const initial = await caller.mapping.unmapped();

  return (
    <div>
      <SectionHeader
        level={1}
        title="מיפוי מק״טים"
        subtitle="מק״טים מהזמנות וחשבוניות שעדיין לא חוברו למוצר בקטלוג. חיבור חד-פעמי — וכל הזמנה עתידית מאותו ספק תזוהה אוטומטית."
      />
      <div className="mt-4">
        <SkuMapper initial={initial} />
      </div>
    </div>
  );
}
