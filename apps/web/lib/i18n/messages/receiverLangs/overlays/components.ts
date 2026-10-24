import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../components/he';
import { components as ar } from './ar/components';
import { components as ru } from './ru/components';
import { components as th } from './th/components';
import { components as ti } from './ti/components';

/** Receiver-locale overlays of 'components' — complete in every receiver locale (type-checked). */
export const componentsOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
