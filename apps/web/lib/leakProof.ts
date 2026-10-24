/**
 * "How did we get to ₪X?" (flag `leakProof`): the proof sheet behind the
 * dashboard hero, assembled ONLY from owner.leakHero + owner.leakBreakdown.
 * No ₪ is computed here — every amount is passed through as the hero and the
 * breakdown return it, so the sheet equals the hero to the agora.
 */

/** The owner.leakHero fields the sheet uses. */
export interface ProofHero {
  monthStart: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  recoveredIls: number;
  invoiceCount: number;
  matchedInvoiceCount: number;
  invoicesWithLeak: number;
  pendingLinkCount: number;
  pendingLinkIls: number;
}

/** The owner.leakBreakdown fields the sheet uses. */
export interface ProofBreakdownInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  status: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  totalInclVat: number;
  leakIls: number;
  pendingLink: boolean;
  lines: {
    discrepancyId: string;
    type: string;
    deltaAmount: number;
    countsAsLeak: boolean;
    productName: string | null;
    productNameEn: string | null;
    lineDescription: string | null;
    lineDescriptionEn: string | null;
    invoiceLineId: string | null;
  }[];
}

export interface ProofFinding {
  discrepancyId: string;
  type: string;
  /** |delta| of the finding, as the breakdown returns it. */
  amountIls: number;
  /** 'line' → links to the invoice line; 'invoice' → an invoice-level finding links to the invoice. */
  level: 'line' | 'invoice';
  href: string;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
}

export interface ProofCatch {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  /** The invoice's capped contribution to the hero leak (breakdown.leakIls). */
  leakIls: number;
  /** True when the invoice's findings add up to more than its leak (the per-invoice cap applied). */
  capped: boolean;
  href: string;
  findings: ProofFinding[];
}

export interface Proof {
  hero: ProofHero;
  /** invoicesWithLeak ≤ matchedInvoiceCount ≤ invoiceCount. */
  countsConsistent: boolean;
  top: ProofCatch[];
}

export const PROOF_TOP = 5;

const invoiceHref = (invoiceId: string) => `/dashboard/invoices/${invoiceId}`;

export function buildProof(hero: ProofHero, breakdown: ProofBreakdownInvoice[]): Proof {
  const top = breakdown
    // Every invoice with leak counts toward the hero — a pending-link invoice
    // too (only the SPEND excludes it): it can be one of the biggest catches.
    .filter((inv) => inv.leakIls > 0)
    // The breakdown already sorts by capped leak; sort again so the sheet never depends on it.
    .sort((a, b) => b.leakIls - a.leakIls)
    .slice(0, PROOF_TOP)
    .map((inv): ProofCatch => {
      const findings = inv.lines
        // A ₪0.00 finding adds nothing to the number: not listed.
        .filter((l) => l.countsAsLeak && Math.round(Math.abs(l.deltaAmount) * 100) > 0)
        .map(
          (l): ProofFinding => ({
            discrepancyId: l.discrepancyId,
            type: l.type,
            amountIls: Math.abs(l.deltaAmount),
            level: l.invoiceLineId ? 'line' : 'invoice',
            href: l.invoiceLineId ? `${invoiceHref(inv.invoiceId)}#line-${l.invoiceLineId}` : invoiceHref(inv.invoiceId),
            productName: l.productName,
            productNameEn: l.productNameEn,
            lineDescription: l.lineDescription,
            lineDescriptionEn: l.lineDescriptionEn,
          }),
        );
      // Compared in agorot so float noise never flags a cap that did not apply.
      const findingsAgorot = findings.reduce((a, f) => a + Math.round(f.amountIls * 100), 0);
      return {
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        supplierName: inv.supplierName,
        supplierNameEn: inv.supplierNameEn,
        leakIls: inv.leakIls,
        capped: findingsAgorot > Math.round(inv.leakIls * 100),
        href: invoiceHref(inv.invoiceId),
        findings,
      };
    });
  return {
    hero,
    countsConsistent:
      hero.invoicesWithLeak <= hero.matchedInvoiceCount && hero.matchedInvoiceCount <= hero.invoiceCount,
    top,
  };
}
