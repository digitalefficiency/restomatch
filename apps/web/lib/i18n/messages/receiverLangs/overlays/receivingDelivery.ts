// Machine translation — pending native review (W1-06 follow-up).
import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../receiving/delivery.he';
import { receivingDelivery as ar } from './ar/receivingDelivery';
import { receivingDelivery as ru } from './ru/receivingDelivery';
import { receivingDelivery as th } from './th/receivingDelivery';
import { receivingDelivery as ti } from './ti/receivingDelivery';

/** Receiver-locale overlays of 'receivingDelivery' (W1-06) — complete in every receiver locale (type-checked). */
export const receivingDeliveryOverlays: CompleteOverlays<typeof he> = { ar, ru, th, ti };
