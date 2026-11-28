import type { Shape } from '../../translate';

/**
 * The invoices list's own strings, merged into the 'invoices' namespace as `list.*` by
 * ./index.ts. Owner: INV-02 (the invoices list). Created empty by INV-00 (seam S3); both
 * languages live here, Hebrew first.
 */
export const listHe = {};

export const listEn: Shape<typeof listHe> = {};
