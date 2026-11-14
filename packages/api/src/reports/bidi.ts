/**
 * The PDF visual-order helper now lives in @restomatch/types (money/visualOrder.ts,
 * G-13) so every server channel shares one implementation; re-exported here so
 * reports/pdf.ts and existing importers are unchanged.
 */
export { visualOrder, type Dir } from '@restomatch/types';
