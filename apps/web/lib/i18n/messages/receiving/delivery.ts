import { defineMessages, withReceiverLocales } from '../../translate';
import { receivingDeliveryOverlays } from '../receiverLangs/overlays/receivingDelivery';
import { en } from './delivery.en';
import { he } from './delivery.he';

/**
 * Delivery Check strings (W1-06): capture, count, save state, leave guard,
 * sign-out guard. Lives beside 'receiving' (see delivery.he.ts for why) and is
 * registered in messages/index.ts (ALL_NAMESPACES). Receiver languages
 * (ar/ru/th/ti): complete overlays, see receiverLangs/overlays/receivingDelivery.
 */
export const receivingDelivery = withReceiverLocales(defineMessages('receivingDelivery', he, en), receivingDeliveryOverlays);
