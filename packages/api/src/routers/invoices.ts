import { router } from '../trpc';

/**
 * Invoice register, cockpit and intake (wave 2, W2-02).
 *
 * Registered empty in wave 1 (W1-04) so later packages add procedures here
 * without editing `index.ts`. Every procedure added needs a COVERAGE entry
 * and a cross-tenant attack test (DoD-8).
 */
export const invoicesRouter = router({});
