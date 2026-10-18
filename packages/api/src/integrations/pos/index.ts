import { csvPosProvider } from './csv';
import type { PosSalesProvider } from './types';

export * from './types';
export { csvPosProvider, decodePosBytes, detectPosColumns, parsePosDate, parseScaled, MAX_POS_BYTES } from './csv';

/** POS providers by id. API providers (Tabit, Beecomm…) register here once activated. */
export const POS_PROVIDERS: Record<string, PosSalesProvider> = { csv: csvPosProvider };
export const POS_PROVIDER_IDS = ['csv'] as const;
