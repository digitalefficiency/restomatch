import { router } from '../trpc';

/**
 * Month close checklist (later wave).
 *
 * Registered empty in wave 1 (W1-04) so later packages add procedures here
 * without editing `index.ts`. Every procedure added needs a COVERAGE entry
 * and a cross-tenant attack test (DoD-8).
 */
export const closeRouter = router({});
