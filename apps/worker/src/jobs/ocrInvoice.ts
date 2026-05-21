import { makeWorker } from '../queue';

export interface OcrInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  imageUrl: string;
}

export function startOcrInvoiceWorker() {
  return makeWorker<OcrInvoiceJob>('ocr-invoice', async (job) => {
    console.log('[ocr-invoice] TODO run OCR pipeline', job.data);
    return { ok: true };
  });
}
