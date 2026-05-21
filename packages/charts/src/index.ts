export interface OwnerKpis {
  monthPotentialLossIls: number;
  monthSavingsCapturedIls: number;
  pendingApprovalsCount: number;
  weekCleanMatchPct: number;
}

export interface LeakRow {
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  baselineP50: number;
  lastObservedPrice: number;
  deltaPct: number;
  monthCostExcessIls: number;
}

export interface SupplierScorecard {
  supplierId: string;
  supplierName: string;
  cleanDeliveryPct: number;
  avgPriceDeltaPct: number;
  duplicateInvoicesCount: number;
  avgLeadTimeHours: number;
  trend: 'up' | 'down' | 'flat';
}

export function emptyKpis(): OwnerKpis {
  return {
    monthPotentialLossIls: 0,
    monthSavingsCapturedIls: 0,
    pendingApprovalsCount: 0,
    weekCleanMatchPct: 100,
  };
}
