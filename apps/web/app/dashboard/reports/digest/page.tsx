import { permanentRedirect } from 'next/navigation';
import { legacyTarget } from '../monthly/logic';

/**
 * The e-mail digest preview is now the "כך זה נשלח" tab of "דוח החודש"
 * (W3-08, owner decision I4: one copy of the month). Old links answer 308.
 */
export default async function MonthlyDigestPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  permanentRedirect(legacyTarget('/dashboard/reports/digest', sp.month));
}
