import { runMatch, type MatchInput, type MatchOutput } from '@restomatch/matching';
import { makeWorker } from '../queue';

export interface MatchInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  input: MatchInput;
}

export function startMatchInvoiceWorker() {
  return makeWorker<MatchInvoiceJob>('match-invoice', async (job): Promise<MatchOutput> => {
    const result = runMatch(job.data.input);
    console.log(
      `[match-invoice] restaurant=${job.data.restaurantId} invoice=${job.data.invoiceId} ` +
        `status=${result.status} discrepancies=${result.discrepancies.length} ` +
        `loss=₪${result.totalDiscrepancyAmount.toFixed(2)}`,
    );
    return result;
  });
}
