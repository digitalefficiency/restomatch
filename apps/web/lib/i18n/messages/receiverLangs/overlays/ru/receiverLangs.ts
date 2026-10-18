import type { Shape } from '../../../../translate';
import type { he } from '../../he';

/** receiverLangs — ru overlay (Russian). */
export const receiverLangs: Shape<typeof he> = {
  picker: {
    label: 'Язык',
    title: 'Выберите язык приложения',
    hint: 'Языки для приёмки: арабский, русский, тайский, тигринья. Остальные экраны — на английском.',
  },
  lines: {
    original: 'Оригинал',
    machine: 'Машинный перевод — сверьте с накладной',
    untranslated: 'Нет перевода — показано на языке оригинала',
  },
};
