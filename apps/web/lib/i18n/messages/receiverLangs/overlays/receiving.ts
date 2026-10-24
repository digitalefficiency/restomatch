import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../receiving/he';
import { receiving as ar } from './ar/receiving';
import { receiving as ru } from './ru/receiving';
import { receiving as th } from './th/receiving';
import { receiving as ti } from './ti/receiving';

/** Receiver-locale overlays of 'receiving' — complete in every receiver locale (type-checked). */
export const receivingOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
