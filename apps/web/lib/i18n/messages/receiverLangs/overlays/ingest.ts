import type { CompleteOverlays } from '../../../translate';
import type { he } from '../../ingest/he';
import { ingest as ar } from './ar/ingest';
import { ingest as ru } from './ru/ingest';
import { ingest as th } from './th/ingest';
import { ingest as ti } from './ti/ingest';

/**
 * Receiver-locale overlays of 'ingest' — the receiver-PWA slice (pwa.*: offline
 * banner, "saved on the phone", queue count, sync status), complete in every
 * receiver locale (type-checked). The rest of 'ingest' (the owner's invoice
 * inbox) falls back to English.
 */
export const ingestOverlays: CompleteOverlays<Pick<typeof he, 'pwa'>> = { ar, ru, th, ti };
