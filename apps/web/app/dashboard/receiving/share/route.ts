import { NextResponse, type NextRequest } from 'next/server';

/**
 * PWA share target (manifest `share_target`, inside the receiver app's scope):
 * sharing a WhatsApp order message to the installed app lands here and goes
 * to the order-capture screen pre-filled (flag `orderCapture`; that page 404s
 * when the flag is off or the role cannot create orders). Same-origin redirect
 * only — the shared text is passed as a query value, never as a URL.
 */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const text = [p.get('title'), p.get('text'), p.get('url')]
    .filter((s): s is string => !!s && s.trim() !== '')
    .join('\n')
    .slice(0, 8000);
  const to = new URL('/dashboard/orders/capture', req.nextUrl.origin);
  if (text) to.searchParams.set('text', text);
  return NextResponse.redirect(to, 303);
}
