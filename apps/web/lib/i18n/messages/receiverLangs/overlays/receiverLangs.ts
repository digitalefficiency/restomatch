import type { CompleteOverlays } from '../../../translate';
import type { he } from '../he';
import { receiverLangs as ar } from './ar/receiverLangs';
import { receiverLangs as ru } from './ru/receiverLangs';
import { receiverLangs as th } from './th/receiverLangs';
import { receiverLangs as ti } from './ti/receiverLangs';

/** Receiver-locale overlays of 'receiverLangs' — complete in every receiver locale (type-checked). */
export const receiverLangsOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
