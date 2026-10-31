import { TRPCError } from '@trpc/server';

/**
 * Stable, machine-readable domain error codes ("appCode").
 *
 * Router messages stay human Hebrew (logs, legacy callers), but clients must
 * never key off message text: every known domain error carries one of these
 * codes, exposed to tRPC clients as `error.data.appCode` by the errorFormatter
 * in trpc.ts (and readable server-side as `error.cause.appCode`).
 */
export const APP_ERROR_CODES = [
  'team.alreadyMember',
  'team.pendingInvite',
  'team.inviteNotFound',
  'team.resendPendingOnly',
  'team.memberNotFound',
  'team.lastOwner',
  'team.inviteUsed',
  'team.inviteExpired',
  'team.userNotFound',
  'team.inviteWrongEmail',
  'onboarding.accountGone',
  'settings.invalidTimezone',
  'settings.noChanges',
  'dsr.soleOwner',
  'admin.lastOwner',
  'admin.notFound',
  'subscription.inactive',
  'quota.exceeded',
  'entitlement.required',
  'auth.unauthorized',
  'auth.forbidden',
  'input.invalid',
  'invoice.numberTaken',
  'FEATURE_DISABLED',
  'leakCheck.invalidLink',
  'growth.referralInvalid',
  'growth.referralSelf',
  'growth.referralAlreadyRedeemed',
  'invoice.linesLocked',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];
export type AppErrorParams = Record<string, string | number>;

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}

/** The `cause` carried by an appError — duck-typed by clients via `.appCode`. */
export class AppErrorCause extends Error {
  constructor(
    readonly appCode: AppErrorCode,
    readonly appParams?: AppErrorParams,
  ) {
    super(appCode);
    this.name = 'AppErrorCause';
  }
}

/** A TRPCError with a stable appCode (message stays the human Hebrew text). */
export function appError(
  code: TRPCError['code'],
  appCode: AppErrorCode,
  message: string,
  appParams?: AppErrorParams,
): TRPCError {
  return new TRPCError({ code, message, cause: new AppErrorCause(appCode, appParams) });
}

interface ZodLikeIssue {
  params?: { appCode?: unknown };
}

/**
 * Resolve the appCode of any procedure error: an explicit appError cause, an
 * entitlement/quota error, a zod input issue that declares `params.appCode`,
 * or a generic role/auth/input failure. Null = no stable code (callers fall
 * back to the message).
 */
export function resolveAppError(error: TRPCError): { appCode: AppErrorCode; appParams?: AppErrorParams } | null {
  const cause = error.cause as
    | (Error & { appCode?: unknown; appParams?: AppErrorParams; limit?: number | null; issues?: ZodLikeIssue[] })
    | undefined;

  if (cause && isAppErrorCode(cause.appCode)) {
    return { appCode: cause.appCode, ...(cause.appParams ? { appParams: cause.appParams } : {}) };
  }
  if (cause?.name === 'QuotaExceededError') {
    // limit 0 ⇔ inactive subscription (see meterOcrScan); otherwise the cap.
    return cause.limit === 0 || cause.limit == null
      ? { appCode: 'subscription.inactive' }
      : { appCode: 'quota.exceeded', appParams: { limit: cause.limit } };
  }
  if (error.message.startsWith('ENTITLEMENT_REQUIRED:')) {
    return { appCode: 'entitlement.required', appParams: { feature: error.message.slice('ENTITLEMENT_REQUIRED:'.length) } };
  }
  if (cause?.name === 'ZodError' && Array.isArray(cause.issues)) {
    const declared = cause.issues.map((i) => i.params?.appCode).find(isAppErrorCode);
    return { appCode: declared ?? 'input.invalid' };
  }
  if (error.code === 'UNAUTHORIZED') return { appCode: 'auth.unauthorized' };
  if (error.code === 'FORBIDDEN') return { appCode: 'auth.forbidden' };
  return null;
}

/** Generic text shown instead of an unexpected server error's raw message. */
export const GENERIC_INTERNAL_MESSAGE = 'Internal server error';

/**
 * The message a client may see. In production an INTERNAL_SERVER_ERROR without
 * a stable appCode is an unexpected failure (driver/DB/bug) whose raw text can
 * reveal schema, constraint names or SQL — replace it with a generic string.
 * Deliberate errors (any other code, or a coded one) keep their message. Dev
 * keeps everything for debugging.
 */
export function publicErrorMessage(
  error: TRPCError,
  resolved: { appCode: AppErrorCode } | null,
  isProduction: boolean,
): string {
  if (isProduction && error.code === 'INTERNAL_SERVER_ERROR' && !resolved) {
    return GENERIC_INTERNAL_MESSAGE;
  }
  return error.message;
}
