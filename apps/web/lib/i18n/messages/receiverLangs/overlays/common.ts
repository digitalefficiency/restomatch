// Machine translation — pending native review (W1-06 follow-up).
import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../common/he';
import { common as ar } from './ar/common';
import { common as ru } from './ru/common';
import { common as th } from './th/common';
import { common as ti } from './ti/common';

/**
 * The receiver-facing slice of 'common': generic actions/states, plus shell
 * resilience (W1-04) — offline chip, re-auth sheet, 403/404/error — and the
 * screen names those pages interpolate.
 */
export type CommonReceiverSlice = Pick<typeof he, 'actions' | 'states'> & {
  shell: Pick<
    (typeof he)['shell'],
    'offline' | 'session' | 'forbidden' | 'notFound' | 'error' | 'screens' | 'listSep' | 'listLast'
  >;
};

/** Receiver-locale overlays of 'common' (receiver slice) — complete in every receiver locale (type-checked). */
export const commonOverlays: CompleteOverlays<CommonReceiverSlice> = { ar, ru, th, ti };
