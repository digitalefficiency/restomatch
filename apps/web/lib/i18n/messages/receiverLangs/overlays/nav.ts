import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../nav/he';
import { nav as ar } from './ar/nav';
import { nav as ru } from './ru/nav';
import { nav as th } from './th/nav';
import { nav as ti } from './ti/nav';

/** Receiver-locale overlays of 'nav' — complete in every receiver locale (type-checked). */
export const navOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
