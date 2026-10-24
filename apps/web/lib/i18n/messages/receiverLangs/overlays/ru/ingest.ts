import type { Shape } from '../../../../translate';
import type { he } from '../../../ingest/he';

/** ingest — ru overlay (Russian): the receiver-PWA strings only (pwa.*). Machine-drafted; needs the native-speaker pass. */
export const ingest: Shape<Pick<typeof he, 'pwa'>> = {
  pwa: {
    offlineTitle: 'Нет подключения к интернету',
    offlineBody: 'Можно продолжать фотографировать. Фото сохраняются на телефоне и загрузятся сами, когда связь вернётся.',
    queued: 'Фото ждут загрузки: {count}',
    queuedOne: '1 фото ждёт загрузки',
    syncing: 'Загружаем сохранённые фото…',
    synced: 'Все фото загружены',
    syncFailed: 'Не удалось загрузить, скоро попробуем снова',
    savedOffline: 'Фото сохранено на телефоне и загрузится, когда связь вернётся',
    install: 'Установить приложение приёмки',
    installHint: 'Ярлык на главном экране — сразу открывает приёмку товара.',
    installed: 'Режим приложения',
  },
};
