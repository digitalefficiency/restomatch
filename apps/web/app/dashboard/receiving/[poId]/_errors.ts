import { TRPCClientError } from '@trpc/client';
import type { Locale } from '@/lib/i18n/config';
import type { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';
import { localizeServerError } from '@/lib/serverErrors';

/** tRPC codes whose meaning the shared localizer translates for the user. */
const MAPPED_CODES = new Set(['FORBIDDEN', 'UNAUTHORIZED', 'BAD_REQUEST']);

/**
 * Receiver-facing text for a failed request (WIZ-ERR-1). Only errors that
 * carry a stable meaning are shown specifically: coded domain errors
 * (`appCode`: quota, inactive subscription…) and mapped tRPC codes go through
 * localizeServerError; NOT_FOUND has its own wording; a dropped connection gets
 * the network message. Everything else — "Internal server error", "Failed to
 * fetch", stack-ish text — becomes the generic message.
 */
export function receivingErrorText(err: unknown, t: Translator<typeof receiving.he>, locale: Locale): string {
  if (err instanceof TRPCClientError) {
    const data = (err.data ?? {}) as { code?: string; appCode?: string };
    if (data.code === 'NOT_FOUND') return t('errors.notFound');
    if (data.appCode || (data.code && MAPPED_CODES.has(data.code))) {
      return localizeServerError(err, locale, t('errors.generic'));
    }
    if (isNetworkError(err.cause) || isNetworkError(err)) return t('errors.network');
    return t('errors.generic');
  }
  if (isNetworkError(err)) return t('errors.network');
  return t('errors.generic');
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message);
}
