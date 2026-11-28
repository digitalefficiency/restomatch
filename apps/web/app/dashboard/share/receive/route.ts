import { NextResponse, type NextRequest } from 'next/server';

/**
 * W3-03b · the manifest's share_target action (POST multipart). The service
 * worker normally answers it on the device (files parked in Cache Storage).
 * This route is the fallback when no worker controls the page (first launch,
 * a browser without workers): it keeps the TEXT (title, text, link) and drops
 * any file (nothing is stored server-side), then 303 → /dashboard/share, which
 * routes it. Never a 404. It writes nothing; the dashboard middleware still
 * requires a session for this path.
 */
const MAX = 8000;

export async function POST(req: NextRequest) {
  const params = new URLSearchParams();
  try {
    const form = await req.formData();
    for (const k of ['title', 'text', 'url'] as const) {
      const v = form.get(k);
      if (typeof v === 'string' && v.trim()) params.set(k, v.slice(0, MAX));
    }
    if (form.getAll('files').some((f) => typeof f !== 'string')) params.set('files', 'lost');
  } catch {
    params.set('error', 'unreadable');
  }
  const qs = params.toString();
  return NextResponse.redirect(new URL(`/dashboard/share${qs ? `?${qs}` : ''}`, req.nextUrl.origin), 303);
}

/** A GET (an old manifest, a typed URL) lands on the share page too. */
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL(`/dashboard/share${req.nextUrl.search}`, req.nextUrl.origin), 303);
}
