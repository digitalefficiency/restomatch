import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../scans/he';
import { scans as ar } from './ar/scans';
import { scans as ru } from './ru/scans';
import { scans as th } from './th/scans';
import { scans as ti } from './ti/scans';

/** Receiver-locale overlays of 'scans' — complete in every receiver locale (type-checked). */
export const scansOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
