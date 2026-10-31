import { createTranslator, type Translator } from '@/lib/i18n/translate';
import type { components } from '@/lib/i18n/messages/components';
import { common } from '@/lib/i18n/messages/common';

type ComponentsTree = (typeof components)['he'];

/** tRPC error code (`FORBIDDEN`, `CONFLICT`, …) of a client or server error, if any. */
export function trpcErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const data = (err as { data?: { code?: unknown } | null }).data;
  if (data && typeof data.code === 'string') return data.code;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Turn a thrown tRPC/network error into a sentence the user can act on, in the
 * active locale. Server messages are Hebrew (and sometimes raw zod JSON), so we
 * never surface them directly: callers pass per-code overrides for the cases
 * that matter on their screen (e.g. `{ CONFLICT: t('catalog.errors.duplicateSku') }`)
 * and everything else maps to a generic, localized message.
 */
export function friendlyError(
  err: unknown,
  t: Translator<ComponentsTree>,
  overrides: Partial<Record<string, string>> = {},
): string {
  const code = trpcErrorCode(err);
  if (code && overrides[code]) return overrides[code]!;
  switch (code) {
    case 'FORBIDDEN':
      return t('errors.forbidden');
    // The session is gone, not the permission: say so (perf-states-15). The copy
    // lives in `common` (W1-04 owns it), in the same locale as `t`.
    case 'UNAUTHORIZED': {
      const tc = createTranslator(t.appLocale, common);
      return `${tc('shell.session.title')}. ${tc('shell.session.body')}`;
    }
    case 'NOT_FOUND':
      return t('errors.notFound');
    case 'BAD_REQUEST':
    case 'PARSE_ERROR':
      return t('errors.validation');
    case 'TOO_MANY_REQUESTS':
      return t('errors.tooMany');
    default:
      break;
  }
  const message = err instanceof Error ? err.message : '';
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(message)) return t('errors.network');
  return t('errors.generic');
}
