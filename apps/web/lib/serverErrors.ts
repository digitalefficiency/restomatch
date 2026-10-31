import type { AppErrorCode } from '@restomatch/api';
import { auth as authMessages } from './i18n/messages/auth';
import type { Locale } from './i18n/config';
import { createTranslator, type MessageKey } from './i18n/translate';

type Key = MessageKey<typeof authMessages.he.serverErrors>;

/**
 * PRIMARY path: the stable machine code the API attaches to every known domain
 * error (`error.data.appCode` over HTTP via the errorFormatter, or
 * `error.cause.appCode` on a direct server-side caller). Exhaustive — a new
 * server code without a translation is a type error here.
 */
const BY_APP_CODE: Record<AppErrorCode, Key> = {
  'team.alreadyMember': 'alreadyMember',
  'team.pendingInvite': 'pendingInvite',
  'team.inviteNotFound': 'inviteNotFound',
  'team.resendPendingOnly': 'resendPendingOnly',
  'team.memberNotFound': 'memberNotFound',
  'team.lastOwner': 'lastOwner',
  'team.inviteUsed': 'inviteUsed',
  'team.inviteExpired': 'inviteExpired',
  'team.userNotFound': 'userNotFound',
  'team.inviteWrongEmail': 'inviteWrongEmail',
  'onboarding.accountGone': 'accountGone',
  // /onboarding shows its own invitation-only note; this is the generic fallback.
  signup_closed: 'forbidden',
  'settings.invalidTimezone': 'invalidTimezone',
  'settings.noChanges': 'noChanges',
  'dsr.soleOwner': 'soleOwner',
  'admin.lastOwner': 'adminLastOwner',
  'admin.notFound': 'notFound',
  'subscription.inactive': 'subscriptionInactive',
  'quota.exceeded': 'quotaExceeded',
  'entitlement.required': 'entitlementRequired',
  'auth.unauthorized': 'unauthorized',
  'auth.forbidden': 'forbidden',
  'input.invalid': 'invalidInput',
  'invoice.numberTaken': 'invoiceNumberTaken',
  // Wave-1 (S15) codes: generic fallbacks here; the owning screens (growth /
  // leakCheck namespaces) show their own specific copy.
  FEATURE_DISABLED: 'forbidden',
  'leakCheck.invalidLink': 'invalidInput',
  'growth.referralInvalid': 'invalidInput',
  'growth.referralSelf': 'invalidInput',
  'growth.referralAlreadyRedeemed': 'invalidInput',
};

/**
 * FALLBACK path (older servers / uncoded errors): server-thrown errors in the S4 routers (team / onboarding / settings / dsr /
 * entitlements) carry a Hebrew message — the stable identifier. This maps each
 * known message (or its stable prefix code) to a translated string so English
 * users never see Hebrew, while the server contract stays unchanged.
 */
const BY_HEBREW_MESSAGE: Record<string, Key> = Object.fromEntries(
  (Object.entries(authMessages.he.serverErrors) as [Key, string][]).map(([k, v]) => [v, k]),
) as Record<string, Key>;

const BY_PREFIX: Array<[string, Key]> = [
  ['SOLE_OWNER_TRANSFER_REQUIRED', 'soleOwner'],
  ['חרגתם ממכסת הסריקות', 'quotaExceeded'],
];

const BY_TRPC_CODE: Partial<Record<string, Key>> = {
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'unauthorized',
  BAD_REQUEST: 'invalidInput',
};

interface ErrorLike {
  message?: unknown;
  data?: { code?: unknown; appCode?: unknown; appParams?: unknown } | null;
  cause?: { appCode?: unknown; appParams?: unknown } | null;
}

function appCodeOf(e: ErrorLike): { key: Key; params: Record<string, string | number> } | null {
  const code = e.data?.appCode ?? e.cause?.appCode;
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(BY_APP_CODE, code)) return null;
  const rawParams = e.data?.appParams ?? e.cause?.appParams;
  const params =
    rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, string | number>) : {};
  return { key: BY_APP_CODE[code as AppErrorCode], params };
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
  const coded = appCodeOf(e);
  if (coded) return t(`serverErrors.${coded.key}`, coded.params);
  const raw = typeof e.message === 'string' ? e.message.trim() : '';
  const message = firstZodMessage(raw) ?? raw;

  const exact = BY_HEBREW_MESSAGE[message];
  if (exact) return t(`serverErrors.${exact}`);
  for (const [prefix, key] of BY_PREFIX) {
    // The quota message embeds the cap as "(N)" — carry it into the translation.
    if (message.startsWith(prefix)) return t(`serverErrors.${key}`, { limit: message.match(/\((\d+)\)/)?.[1] ?? '' });
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
