// Machine translation — pending native review (W1-06 follow-up).
import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../overview/he';
import { overview as ar } from './ar/overview';
import { overview as ru } from './ru/overview';
import { overview as th } from './th/overview';
import { overview as ti } from './ti/overview';

/** The receiver-facing slice of 'overview': the receiver's home h1/subtitle and the deliveries board. */
export type OverviewReceiverSlice = Pick<typeof he, 'board'> & {
  homeTitle: Pick<(typeof he)['homeTitle'], 'receiver'>;
  homeSubtitle: Pick<(typeof he)['homeSubtitle'], 'receiver'>;
};

/** Receiver-locale overlays of 'overview' (receiver slice) — complete in every receiver locale (type-checked). */
export const overviewOverlays: CompleteOverlays<OverviewReceiverSlice> = { ar, ru, th, ti };
