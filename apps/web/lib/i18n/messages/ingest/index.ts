import { defineMessages, withReceiverLocales } from '../../translate';
import { ingestOverlays } from '../receiverLangs/overlays/ingest';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): the receiver-PWA strings (pwa.*) are
// overlaid — receivers on those locales use the PWA; the inbox stays English.
export const ingest = withReceiverLocales(defineMessages('ingest', he, en), ingestOverlays);
