'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { ErrorNotice, Spinner, friendlyError, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import { SupplierForm } from '../manager';
import { scheduleToForm, toUpdatePatch } from '../form-logic';

/**
 * Details tab — reuses the canonical SupplierForm from the manager so name /
 * English name / contact / payment terms (and the info-only delivery grid) are
 * edited with one code path. Saves via suppliers.update; cleared fields are
 * sent as null so they really clear.
 */
export function SupplierDetailsTab({ supplierId }: { supplierId: string }) {
  const t = useT(suppliersNs);
  const tc = useT(components);
  const toast = useToast();
  const router = useRouter();
  const utils = trpc.useUtils();
  const supplier = trpc.suppliers.get.useQuery({ supplierId });
  // Bumped after a successful save so the form re-hydrates from the saved row.
  const [formKey, setFormKey] = useState(0);

  const update = trpc.suppliers.update.useMutation({
    onSuccess: async () => {
      toast.success(t('form.saved'));
      await utils.suppliers.get.invalidate({ supplierId });
      void utils.suppliers.list.invalidate();
      setFormKey((k) => k + 1);
      router.refresh(); // header (server layout) shows the new name
    },
  });

  if (supplier.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> {t('detail.loading')}
      </div>
    );
  }

  const s = supplier.data;
  if (!s) return <ErrorNotice message={supplier.error ? friendlyError(supplier.error, tc) : undefined} />;

  return (
    <SupplierForm
      key={`${s.id}-${formKey}`}
      title={t('form.detailsTitle')}
      cancelLabel={t('form.reset')}
      initial={{
        name: s.name,
        nameEn: s.nameEn ?? '',
        businessId: s.businessId ?? '',
        contactEmail: s.contactEmail ?? '',
        contactWhatsapp: s.contactWhatsapp ?? '',
        paymentTerms: s.paymentTerms ?? '',
        schedule: scheduleToForm(s.deliverySchedule),
      }}
      submitting={update.isPending}
      error={update.error ? friendlyError(update.error, tc) : null}
      onCancel={() => update.reset()}
      onSubmit={(form) => update.mutate({ supplierId, patch: toUpdatePatch(form) })}
    />
  );
}
