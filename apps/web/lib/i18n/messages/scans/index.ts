import { defineMessages, withReceiverLocales } from '../../translate';
import { scansOverlays } from '../receiverLangs/overlays/scans';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays, see receiverLangs/overlays.
export const scans = withReceiverLocales(defineMessages('scans', he, en), scansOverlays);
