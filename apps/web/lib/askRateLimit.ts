import 'server-only';
import { ASK_BURST_LIMIT, setAskBurstLimiter } from '@restomatch/api';
import { enforceRateLimit } from './rateLimit';

/**
 * "Ask RestoMatch" (S14): back the assistant's per-minute/restaurant burst limit
 * with the shared rate-limit store (Redis when REDIS_URL is set), so the limit
 * holds across serverless instances. Registered once per server process from
 * instrumentation.node.ts; the API keeps its process-local window on top.
 */
export function registerAskRateLimit(): void {
  setAskBurstLimiter(async (restaurantId) => (await enforceRateLimit(restaurantId, { ...ASK_BURST_LIMIT })).allowed);
}
