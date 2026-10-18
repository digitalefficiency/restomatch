import { auth as authMessages } from './i18n/messages/auth';
import type { Locale } from './i18n/config';
import { createTranslator, type MessageKey } from './i18n/translate';

type Key = MessageKey<typeof authMessages.he.serverErrors>;

/**
 * Server-thrown errors in the S4 routers (team / onboarding / settings / dsr /
 * entitlements) carry a Hebrew message — the stable identifier. This maps each
 * known message (or its stable prefix code) to a translated string so English
 * users never see Hebrew, while the server contract stays unchanged.
 */
const BY_HEBREW_MESSAGE: Record<string, Key> = Object.fromEntries(
  (Object.entries(authMessages.he.serverErrors) as [Key, string][]).map(([k, v]) => [v, k]),
) as Record<string, Key>;

const BY_PREFIX: Array<[string, Key]> = [
  ['SOLE_OWNER_TRANSFER_REQUIRED', 'soleOwner'],
  ['חרגתם ממכסת הסריקות', 'subscriptionInactive'],
];

const BY_TRPC_CODE: Partial<Record<string, Key>> = {
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'unauthorized',
  BAD_REQUEST: 'invalidInput',
};

interface ErrorLike {
  message?: unknown;
  data?: { code?: unknown } | null;
}

/** Zod input errors arrive as a JSON array of issues; take the first message. */
function firstZodMessage(message: string): string | null {
  if (!message.startsWith('[')) return null;
  try {
    const issues = JSON.parse(message) as Array<{ message?: string }>;
    return typeof issues[0]?.message === 'string' ? issues[0].message : null;
  } catch {
    return null;
  }
}

export function localizeServerError(err: unknown, locale: Locale, fallback?: string): string {
  const t = createTranslator(locale, authMessages);
  const e = (err ?? {}) as ErrorLike;
  const raw = typeof e.message === 'string' ? e.message.trim() : '';
  const message = firstZodMessage(raw) ?? raw;

  const exact = BY_HEBREW_MESSAGE[message];
  if (exact) return t(`serverErrors.${exact}`);
  for (const [prefix, key] of BY_PREFIX) {
    if (message.startsWith(prefix)) return t(`serverErrors.${key}`);
  }
  const code = typeof e.data?.code === 'string' ? e.data.code : '';
  const byCode = BY_TRPC_CODE[code];
  const isHebrew = /[\u0590-\u05ff]/.test(message);
  // An unmapped Hebrew message is fine in Hebrew — but never leaks into English.
  if (isHebrew && locale === 'he') return message;
  // Raw developer messages ("Required role: owner, got: chef") are not UX copy:
  // prefer the translated tRPC-code string when there is one.
  if (byCode) return t(`serverErrors.${byCode}`);
  if (message && !isHebrew && !raw.startsWith('[')) return message;
  return fallback ?? t('serverErrors.generic');
}
