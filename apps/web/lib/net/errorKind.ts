import { trpcErrorCode } from '@/lib/components/errors';

/** Codes that a retry cannot fix — the request itself (or the session) is the problem. */
const CLIENT_CODES = new Set([
  'BAD_REQUEST',
  'PARSE_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_SUPPORTED',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_CONTENT',
  'TOO_MANY_REQUESTS',
]);

/** The session is gone (expired, revoked, signed out elsewhere). */
export function isUnauthorized(err: unknown): boolean {
  return trpcErrorCode(err) === 'UNAUTHORIZED';
}

/** A 4xx-class tRPC error: retrying the same call gives the same answer. */
export function isClientError(err: unknown): boolean {
  const code = trpcErrorCode(err);
  if (code && CLIENT_CODES.has(code)) return true;
  const status = (err as { data?: { httpStatus?: unknown } | null } | null)?.data?.httpStatus;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** fetch() itself failed (no response at all): offline, DNS, captive portal. */
export function isNetworkError(err: unknown): boolean {
  if (trpcErrorCode(err)) return false;
  const message = err instanceof Error ? err.message : '';
  return /fetch|network|Failed to fetch|NetworkError|Load failed/i.test(message);
}

/** React Query `retry` option: at most 2 retries, never for client errors. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  return !isClientError(err) && failureCount < 2;
}
