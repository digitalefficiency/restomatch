import { defineMessages, withReceiverLocales } from '../../translate';
import { en } from './en';
import { he } from './he';
import { receiverLangsOverlays } from './overlays/receiverLangs';

export const receiverLangs = withReceiverLocales(defineMessages('receiverLangs', he, en), receiverLangsOverlays);
