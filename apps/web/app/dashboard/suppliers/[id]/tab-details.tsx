'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Spinner } from '@/lib/components';
import { SupplierForm, scheduleToForm, toPatch } from '../manager';

/**
 * Details tab — reuses the canonical SupplierForm from the manager so name /
 * contact / payment terms (and the info-only delivery grid) are edited with one
 * code path, never a duplicate. Saves via suppliers.update.
 */
export function SupplierDetailsTab({ supplierId }: { supplierId: string }) {
  const utils = trpc.useUtils();
  const supplier = trpc.suppliers.get.useQuery({ supplierId });
  const [saved, setSaved] = useState(false);

  const update = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.suppliers.get.invalidate({ supplierId });
      void utils.suppliers.list.invalidate();
    },
  });

  if (supplier.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> טוען פרטי ספק…
      </div>
    );
  }

  const s = supplier.data;
  if (!s) return null;

  return (
    <div className="space-y-3">
      <SupplierForm
        title="פרטי ספק"
        initial={{
          name: s.name,
          businessId: s.businessId ?? '',
          contactEmail: s.contactEmail ?? '',
          contactWhatsapp: s.contactWhatsapp ?? '',
          paymentTerms: s.paymentTerms ?? '',
          schedule: scheduleToForm(s.deliverySchedule),
        }}
        submitting={update.isPending}
        error={update.error?.message ?? null}
        onCancel={() => setSaved(false)}
        onSubmit={(form) => {
          setSaved(false);
          update.mutate({ supplierId, patch: toPatch(form) });
        }}
      />
      {saved && !update.isPending && <p className="text-sm text-primary">הפרטים נשמרו.</p>}
    </div>
  );
}
