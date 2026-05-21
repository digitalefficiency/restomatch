import type { InvoiceOcrResult } from '@restomatch/types';

export interface OcrProvider {
  readonly id: 'document_ai' | 'claude_vision';
  extract(image: Buffer | URL): Promise<InvoiceOcrResult>;
}

export interface OcrPipelineResult {
  primary: InvoiceOcrResult;
  reconciled: InvoiceOcrResult;
  confidence: number;
  needsHumanReview: boolean;
  providers: { documentAi: InvoiceOcrResult; claude: InvoiceOcrResult };
}

export async function runOcrPipeline(_image: Buffer | URL): Promise<OcrPipelineResult> {
  throw new Error(
    'runOcrPipeline not yet implemented — see plan section 4.2 (Document AI + Claude Vision).',
  );
}
