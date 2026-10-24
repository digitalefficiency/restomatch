import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../auth/he';
import { auth as ar } from './ar/auth';
import { auth as ru } from './ru/auth';
import { auth as th } from './th/auth';
import { auth as ti } from './ti/auth';

/** Receiver-locale overlays of 'auth' — complete in every receiver locale (type-checked). */
export const authOverlays: CompleteOverlays<Pick<typeof he, 'login' | 'checkEmail' | 'twoFactor'>> = { ar, ru, th, ti };
