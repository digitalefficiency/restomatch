import { MarketManAdapter } from './adapters/marketman';
import { ZesterAdapter } from './adapters/zester';
import type { PlatformId, ProcurementAdapter } from './types';

const adapters = new Map<PlatformId, ProcurementAdapter>([
  ['marketman', new MarketManAdapter()],
  ['zester', new ZesterAdapter()],
]);

export function getAdapter(platform: PlatformId): ProcurementAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }
  return adapter;
}

export function listSupportedPlatforms(): PlatformId[] {
  return Array.from(adapters.keys());
}
