import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { accounting } from '@/lib/i18n/messages/accounting';
import { ExportsForm } from './form';

export default async function ExportsPage() {
  // The form is client-side (downloads need user-initiated requests). Role
  // visibility (owner / bookkeeper) is enforced by middleware + the procedures.
  const t = await getT(accounting);
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <ExportsForm />
    </div>
  );
}
