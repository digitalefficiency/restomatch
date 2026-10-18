import { TRPCError } from '@trpc/server';
import { createServerCaller } from '@/lib/trpc/server';

/**
 * GET /dashboard/reports/monthly/pdf?month=YYYY-MM&locale=he|en — the monthly
 * report as a PDF download. Auth, role (owner/manager), the `monthlyReport`
 * flag and RLS are all enforced by monthlyReport.pdf; the PDF is generated
 * server-side with pdf-lib (no headless browser), so it runs on Vercel.
 */
export const dynamic = 'force-dynamic';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month') ?? '';
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'he';
  if (!MONTH.test(month)) return new Response('bad month', { status: 400 });
  try {
    const caller = await createServerCaller();
    const pdf = await caller.monthlyReport.pdf({ month, locale });
    return new Response(Buffer.from(pdf.base64, 'base64'), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${pdf.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof TRPCError) {
      const status = err.code === 'UNAUTHORIZED' ? 401 : err.code === 'FORBIDDEN' ? 404 : 400;
      return new Response(null, { status });
    }
    throw err;
  }
}
