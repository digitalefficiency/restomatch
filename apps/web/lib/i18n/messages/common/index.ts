import { defineMessages, withReceiverLocales } from '../../translate';
import { commonOverlays } from '../receiverLangs/overlays/common';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti): shell resilience only (W1-04 offline chip,
// re-auth sheet, 403/404/error) — see receiverLangs/overlays/common.
export const common = withReceiverLocales(defineMessages('common', he, en), commonOverlays);
