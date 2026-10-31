import { defineMessages, withReceiverLocales } from '../../translate';
import { overviewOverlays } from '../receiverLangs/overlays/overview';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti): the receiver's home only — the deliveries
// board plus homeTitle/homeSubtitle.receiver (see receiverLangs/overlays/overview).
export const overview = withReceiverLocales(defineMessages('overview', he, en), overviewOverlays);
