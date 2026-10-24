import type { Shape } from '../../../../translate';
import type { he } from '../../../scans/he';

/** scans — ru overlay (Russian). */
export const scans: Shape<typeof he> = {
  scannedInvoice: 'Скан накладной',
  secureLink: 'Защищённая ссылка',
  pages: 'Страниц: {count}',
  localCopy: 'Локальная копия (разработка)',
  notLoading: 'Не открывается? Возможно, мешает блокировщик всплывающих окон или в браузере нет просмотра PDF.',
  openInTab: 'Открыть в новой вкладке',
};
