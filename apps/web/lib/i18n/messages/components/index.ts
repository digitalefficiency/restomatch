import { defineMessages, withReceiverLocales } from '../../translate';
import { componentsOverlays } from '../receiverLangs/overlays/components';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays, see receiverLangs/overlays.
export const components = withReceiverLocales(defineMessages('components', he, en), componentsOverlays);
