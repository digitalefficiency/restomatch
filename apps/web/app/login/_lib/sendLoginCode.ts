import 'server-only';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { clientIpFromHeaders } from '@restomatch/api';
import { getLocale } from '@/lib/i18n/server';
import { enforceMagicLinkLimit, enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';
import { deliverLoginCode } from './codeEmail';
import { issueLoginCode } from './loginCode';

/**
 * Throttle (per mailbox via the magic-link limiter, and per IP), then issue and
 * send the code AFTER the response — a known and an unknown address answer in
 * the same time. Returns false when throttled.
 */
export async function requestLoginCode(email: string): Promise<boolean> {
  const ip = clientIpFromHeaders(await headers(), { trustedProxyHops: trustedProxyHops() });
  const [perMailbox, perIp] = await Promise.all([
    enforceMagicLinkLimit(email),
    enforceRateLimit(ip, { limit: 10, windowSec: 15 * 60, prefix: 'login-code-ip' }),
  ]);
  if (!perMailbox.allowed || !perIp.allowed) return false;
  const locale = await getLocale();
  after(async () => {
    const issued = await issueLoginCode(email);
    if (issued) await deliverLoginCode({ to: issued.email, code: issued.code, locale });
  });
  return true;
}
