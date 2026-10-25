import { defineMessages } from '../../translate';
import { en } from './delivery.en';
import { he } from './delivery.he';

/**
 * Delivery Check strings (W1-06): capture, count, save state, leave guard,
 * sign-out guard. Lives beside 'receiving' (see delivery.he.ts for why) and is
 * imported directly — registering it in messages/index.ts (ALL_NAMESPACES) is
 * left to that file's owner; ./__tests__/delivery.test.ts keeps he ⇄ en parity.
 */
export const receivingDelivery = defineMessages('receivingDelivery', he, en);
