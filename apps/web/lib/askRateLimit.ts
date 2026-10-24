import 'server-only';
import { ASK_BURST_LIMIT, setAskBurstLimiter } from '@restomatch/api';
import { enforceRateLimit } from './rateLimit';

/**
 * "Ask RestoMatch" (S14): back the assistant's per-minute/restaurant burst limit
 * with the app's one rate limiter (`enforceRateLimit`, whatever store backs it),
 * so the limit holds across serverless instances. Registered once per server
 * process from instrumentation.node.ts; the API's in-memory window is only a
 * fallback when this throws.
 */
export function registerAskRateLimit(): void {
  setAskBurstLimiter(async (restaurantId) => (await enforceRateLimit(restaurantId, { ...ASK_BURST_LIMIT })).allowed);
}
