import { defineMessages, withReceiverLocales } from '../../translate';
import { componentsOverlays } from '../receiverLangs/overlays/components';
import { dsEn, dsHe } from './ds';
import { dsReceiver } from './ds.receiver';
import { en } from './en';
import { he } from './he';

// Receiver languages (ar/ru/th/ti, S14): complete overlays of ./he.ts (see
// receiverLangs/overlays) plus the design-system strings (`ds.*`, ./ds.receiver.ts).
export const components = withReceiverLocales(defineMessages('components', { ...he, ds: dsHe }, { ...en, ds: dsEn }), {
  ar: { ...componentsOverlays.ar, ds: dsReceiver.ar },
  ru: { ...componentsOverlays.ru, ds: dsReceiver.ru },
  th: { ...componentsOverlays.th, ds: dsReceiver.th },
  ti: { ...componentsOverlays.ti, ds: dsReceiver.ti },
});
