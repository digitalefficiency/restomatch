import { defineMessages, withReceiverLocales } from '../../translate';
import { navOverlays } from '../receiverLangs/overlays/nav';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays, see receiverLangs/overlays.
export const nav = withReceiverLocales(defineMessages('nav', he, en), navOverlays);
