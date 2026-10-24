import { defineMessages, withReceiverLocales } from '../../translate';
import { receivingOverlays } from '../receiverLangs/overlays/receiving';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays, see receiverLangs/overlays.
export const receiving = withReceiverLocales(defineMessages('receiving', he, en), receivingOverlays);
