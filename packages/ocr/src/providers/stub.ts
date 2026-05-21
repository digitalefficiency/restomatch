import type { InvoiceOcrResult } from '@restomatch/types';
import type { ImageSource, OcrProvider, OcrProviderId } from '../types';

/**
 * Fixture-driven mock provider. Each call returns a pre-configured result.
 * Used in tests and dev — production replaces with real Google/Anthropic clients.
 */
export class StubOcrProvider implements OcrProvider {
  constructor(
    public readonly id: OcrProviderId,
    private readonly result: InvoiceOcrResult,
  ) {}

  async extract(_image: ImageSource): Promise<InvoiceOcrResult> {
    return this.result;
  }
}

/**
 * Routes by image identity (string URL or buffer hash) to a specific fixture.
 * Useful for table-driven tests that exercise many invoice scenarios.
 */
export class FixtureRoutingOcrProvider implements OcrProvider {
  constructor(
    public readonly id: OcrProviderId,
    private readonly routes: Map<string, InvoiceOcrResult>,
    private readonly fallback?: InvoiceOcrResult,
  ) {}

  async extract(image: ImageSource): Promise<InvoiceOcrResult> {
    const key = typeof image === 'string' ? image : image instanceof URL ? image.toString() : '';
    const result = this.routes.get(key);
    if (result) return result;
    if (this.fallback) return this.fallback;
    throw new Error(`No fixture configured for image: ${key.slice(0, 64)}`);
  }
}
