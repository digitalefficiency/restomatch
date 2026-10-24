import { defineMessages, withReceiverLocales } from '../../translate';
import { authOverlays } from '../receiverLangs/overlays/auth';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays, see receiverLangs/overlays.
export const auth = withReceiverLocales(defineMessages('auth', he, en), authOverlays);
