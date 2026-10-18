import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — ar overlay (TODO: translate from English). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'Language',
    title: 'Choose the app language',
    hint: 'Receiver languages: Arabic, Russian, Thai, Tigrinya. Other screens show in English.',
  },
  lines: {
    original: 'Original',
    machine: 'Machine translation — check against the invoice',
    untranslated: 'No translation — shown in the original language',
  },
};
