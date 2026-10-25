import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { getLocale } from '@/lib/i18n/server';
import { formatIls } from '@/lib/money';
import { labCopy } from '../_copy';
import { labRows } from '../_data';

export const metadata = { title: 'Desk lab row · RestoMatch' };

/** The lab's "full page" for a row — the target of Enter / "open full page", so Back can be tested. */
export default async function DeskLabRowPage({ params }: { params: Promise<{ rowId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !(await isPlatformAdmin(session.user.id))) notFound();
  const { rowId } = await params;
  const row = labRows().find((r) => r.id === rowId);
  if (!row) notFound();
  const locale = await getLocale();
  const t = labCopy(locale);
  return (
    <div className="space-y-4" data-lab-detail={row.id}>
      <h1 className="text-2xl font-bold text-ink">
        {t.detailTitle} <bdi dir="ltr" className="font-mono text-xl">{row.number}</bdi>
      </h1>
      <p className="text-ink">{locale === 'en' ? row.supplierEn : row.supplierHe}</p>
      <p className="text-lg font-bold tabular-nums text-ink">
        <bdi>{formatIls(row.totalAgorot / 100, { maximumFractionDigits: 2, locale })}</bdi>
      </p>
      <p className="text-xs text-muted">{t.placeholderNote}</p>
      <Link href="/dashboard/lab/desk" className="inline-flex text-sm font-semibold text-primary underline">
        {t.back}
      </Link>
    </div>
  );
}
