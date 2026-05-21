/**
 * Google Document AI provider — production scaffold.
 *
 * VERIFY: pending real credentials. When environment variables are set:
 *   GOOGLE_APPLICATION_CREDENTIALS (path to service-account JSON)
 *   GOOGLE_DOCUMENT_AI_PROJECT_ID
 *   GOOGLE_DOCUMENT_AI_LOCATION (e.g. "eu")
 *   GOOGLE_DOCUMENT_AI_PROCESSOR_ID (Invoice Parser processor)
 *
 * `npm i @google-cloud/documentai` before enabling.
 */

import type { InvoiceOcrResult } from '@restomatch/types';
import type { ImageSource, OcrProvider } from '../types';

export interface GoogleDocumentAiConfig {
  projectId: string;
  location: string;
  processorId: string;
}

export class GoogleDocumentAi implements OcrProvider {
  readonly id = 'document_ai' as const;

  constructor(private readonly config: GoogleDocumentAiConfig) {}

  async extract(_image: ImageSource): Promise<InvoiceOcrResult> {
    // VERIFY: implementation pending — uses @google-cloud/documentai
    // Pseudocode:
    //   const client = new DocumentProcessorServiceClient();
    //   const name = `projects/${this.config.projectId}/locations/${this.config.location}/processors/${this.config.processorId}`;
    //   const [result] = await client.processDocument({
    //     name,
    //     rawDocument: { content: imageBuffer, mimeType: 'image/jpeg' },
    //   });
    //   return mapDocumentAiToInvoiceOcrResult(result.document);
    throw new Error(
      `GoogleDocumentAi not yet wired — install @google-cloud/documentai and implement extract(). ` +
        `Project: ${this.config.projectId}, location: ${this.config.location}, processor: ${this.config.processorId}`,
    );
  }
}
