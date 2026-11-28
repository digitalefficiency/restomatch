import type { Shape } from '../../translate';

/**
 * The words every screen of the invoices area shares (with whom a gap is, since when, why,
 * what was decided and by which role), merged into the 'invoices' namespace as `gap.*` by
 * ./index.ts. Owner: INV-00. Screens print these through `apps/web/lib/invoices/words.ts`
 * and write no role word or rule phrase of their own.
 */
export const gapHe = {};

export const gapEn: Shape<typeof gapHe> = {};
