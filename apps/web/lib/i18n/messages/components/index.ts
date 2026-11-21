import { defineMessages, withReceiverLocales } from '../../translate';
import { componentsOverlays } from '../receiverLangs/overlays/components';
import { dsEn, dsHe } from './ds';
import { dsReceiver } from './ds.receiver';
import { feedEn, feedHe } from './feed';
import { feedReceiver } from './feed.receiver';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays of ./he.ts (see
// receiverLangs/overlays) plus the design-system strings (`ds.*`, ./ds.receiver.ts) and the feed strings (`feed.*`, W2-13).
export const components = withReceiverLocales(defineMessages('components', { ...he, ds: dsHe, feed: feedHe }, { ...en, ds: dsEn, feed: feedEn }), {
  ar: { ...componentsOverlays.ar, ds: dsReceiver.ar, feed: feedReceiver.ar },
  ru: { ...componentsOverlays.ru, ds: dsReceiver.ru, feed: feedReceiver.ru },
  th: { ...componentsOverlays.th, ds: dsReceiver.th, feed: feedReceiver.th },
  ti: { ...componentsOverlays.ti, ds: dsReceiver.ti, feed: feedReceiver.ti },
});
