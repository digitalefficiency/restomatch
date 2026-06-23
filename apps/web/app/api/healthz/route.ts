import { NextResponse } from 'next/server';

// Liveness probe for the web app (deploy verification + uptime monitoring).
// Intentionally dependency-free and unauthenticated: it answers 200 whenever the
// Next.js server is serving, with no DB/Redis coupling so a downstream outage
// can't make the platform mark the web app itself unhealthy.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'restomatch-web',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  });
}
