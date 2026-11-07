import { claimLetterSubmit } from '../data';
import { handleClaimAnswer } from './handler';

/** H-06ʰ — the supplier's answer to a "מכתב בקשת זיכוי" (public; see handler.ts). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleClaimAnswer(req, token, claimLetterSubmit);
}
