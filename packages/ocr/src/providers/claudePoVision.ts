/**
 * Anthropic Claude provider for PURCHASE-ORDER documents (e.g. a Zestt PDF
 * export). Sibling of ClaudeVision (which handles invoices): same PDF/document
 * content-block plumbing, a dedicated Hebrew-PO extraction prompt, and the
 * result mapped into the canonical NormalizedPurchaseOrder.
 *
 * CREDENTIAL GATE: constructing ClaudePoParser needs a real ANTHROPIC_API_KEY.
 * Callers stay on StubPoParser until keys are live (see the importPo procedure).
 * The SDK is imported lazily so this package typechecks/tests without it.
 */

import { z } from 'zod';
import { NormalizedPurchaseOrder, type PurchaseOrderLine } from '@restomatch/types';
import type { ImageSource, PoDocumentParser } from '../types';
import {
  joinTextBlocks,
  mustFetchBytes,
  parseJsonFromText,
  resolveImage,
  toContentBlock,
} from './_anthropic';

const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_MAX_TOKENS = 16000;

export type PlatformId = z.infer<typeof NormalizedPurchaseOrder>['platform'];

export interface ClaudePoParserConfig {
  apiKey: string;
  /** Platform this parser is extracting for; stamped onto the result. */
  platform: PlatformId;
  /** Claude model id. Falls back to OCR_CLAUDE_MODEL env, then claude-opus-4-8. */
  model?: string;
  maxTokens?: number;
  fetchBytes?: boolean;
}

/**
 * Hebrew purchase-order extraction prompt. Tuned for the Zestt RTL table:
 * שם מוצר | מק״ט | כמות | סה״כ כמות (+יח׳/ק״ג) | מחיר | מחיר סופי, plus the
 * order header (supplier/customer order refs, buyer, delivery date, VAT, totals).
 */
const SYSTEM_PROMPT = `אתה מומחה לקריאת הזמנות רכש (purchase orders) עבריות שמופקות מפלטפורמות רכש (כמו Zestt). הוצא JSON בפורמט הבא בדיוק:
{
  "supplierName": string,
  "supplierOrderRef": string | null,
  "customerOrderRef": string | null,
  "buyerName": string | null,
  "deliveryDate": "YYYY-MM-DD" | null,
  "createdDate": "YYYY-MM-DD" | null,
  "vatRate": number | null,
  "totalExclVat": number | null,
  "totalInclVat": number | null,
  "lines": [{ "productName": string, "sku": string | null, "qty": number, "unit": string, "unitPrice": number | null, "lineTotal": number | null }]
}

חוקים:
- "supplierName" = שם הספק שאליו מופנית ההזמנה (שדה "ספק").
- "supplierOrderRef" = מספר הזמנה אצל הספק (לרוב "מספר הזמנה (ספק)"). זה המזהה היציב של ההזמנה.
- "customerOrderRef" = מספר הזמנה אצל הלקוח ("מספר הזמנה (לקוח)").
- "buyerName" = שם המזמין/הסניף (שדה "מאת").
- "deliveryDate" = התאריך שאליו ההזמנה ("לתאריך"). פורמט YYYY-MM-DD. אם מודפס DD/MM/YYYY — המר.
- "createdDate" = "תאריך יצירה" אם מופיע, פורמט YYYY-MM-DD.
- "vatRate" = שיעור המע״מ כשבר עשרוני (18% → 0.18). אם לא מצוין במפורש, חשב מתוך היחס בין הסכום כולל מע״מ לסכום ללא מע״מ, ועגל ל-0.17 או 0.18.
- "totalExclVat" = הסכום הכולל של ההזמנה ללא מע״מ ("סה״כ בהזמנה (לא כולל מע״מ)").
- "totalInclVat" = המחיר הסופי כולל מע״מ.
- כל שורת מוצר: "productName" (שם מוצר), "sku" (מק״ט אצל הספק, כפי שמודפס; אם אין — null), "qty" (כמות שהוזמנה), "unit" (היחידה כפי שמופיעה: ק״ג / יח׳ / חבילה...), "unitPrice" (מחיר ליחידה), "lineTotal" (מחיר סופי לשורה).
- "unit" — קח את היחידה מעמודת הכמות הכוללת (למשל "(יח׳)" או "(ק״ג)"). שמור בעברית כפי שמופיע.
- אם שדה לא קריא — null, אל תנחש. כל הסכומים מספריים (לא מחרוזות), נקודה עשרונית.

החזר JSON בלבד, ללא טקסט נוסף, ללא code fences.`;

/** Zod schema for the raw model output (before mapping to NormalizedPurchaseOrder). */
const PoExtraction = z.object({
  supplierName: z.string(),
  supplierOrderRef: z.string().nullable().optional(),
  customerOrderRef: z.string().nullable().optional(),
  buyerName: z.string().nullable().optional(),
  deliveryDate: z.string().nullable().optional(),
  createdDate: z.string().nullable().optional(),
  vatRate: z.number().nullable().optional(),
  totalExclVat: z.number().nullable().optional(),
  totalInclVat: z.number().nullable().optional(),
  lines: z.array(
    z.object({
      productName: z.string(),
      sku: z.string().nullable().optional(),
      qty: z.number(),
      unit: z.string(),
      unitPrice: z.number().nullable().optional(),
      lineTotal: z.number().nullable().optional(),
    }),
  ),
});
export type PoExtraction = z.infer<typeof PoExtraction>;

/** Accept ISO (YYYY-MM-DD) or Israeli DD/MM/YYYY; return an ISO datetime string. */
function toIsoDateTime(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const il = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (il) {
    [d, m, y] = [Number(il[1]), Number(il[2]), Number(il[3])];
  } else {
    return undefined;
  }
  // Construct UTC midnight to avoid timezone drift on the delivery date.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
}

/**
 * Map a validated PoExtraction into a NormalizedPurchaseOrder for the given
 * platform. Header identifiers that have no first-class column (customer ref,
 * buyer, VAT rate, incl-VAT total, created date) ride in `metadata`; the import
 * orchestrator promotes the ones with dedicated columns.
 */
export function mapExtractionToNormalized(
  ex: PoExtraction,
  platform: PlatformId,
): NormalizedPurchaseOrder {
  const externalId = (ex.supplierOrderRef ?? '').trim() || `${ex.supplierName}:${ex.deliveryDate ?? ''}`;
  const lines: PurchaseOrderLine[] = ex.lines.map((l) => ({
    sku: l.sku ?? null,
    rawDescription: l.productName,
    qty: l.qty,
    unit: l.unit,
    ...(l.unitPrice != null ? { unitPrice: l.unitPrice } : {}),
    ...(l.lineTotal != null ? { lineTotal: l.lineTotal } : {}),
  }));

  const mapped = {
    externalId,
    platform,
    supplierExternalId: ex.supplierName.trim(),
    supplierName: ex.supplierName.trim(),
    ...(toIsoDateTime(ex.deliveryDate) ? { expectedDeliveryAt: toIsoDateTime(ex.deliveryDate) } : {}),
    status: 'sent' as const,
    currency: 'ILS' as const,
    lines,
    ...(ex.totalExclVat != null ? { totalEstimated: ex.totalExclVat } : {}),
    metadata: {
      vatRate: ex.vatRate ?? null,
      customerOrderRef: ex.customerOrderRef ?? null,
      buyerName: ex.buyerName ?? null,
      totalInclVat: ex.totalInclVat ?? null,
      createdDate: ex.createdDate ?? null,
    },
  };

  return NormalizedPurchaseOrder.parse(mapped);
}

export class ClaudePoParser implements PoDocumentParser {
  constructor(private readonly config: ClaudePoParserConfig) {}

  private get model(): string {
    return this.config.model ?? process.env.OCR_CLAUDE_MODEL ?? DEFAULT_MODEL;
  }

  async parse(image: ImageSource): Promise<NormalizedPurchaseOrder> {
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as { default: any };
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const fetchBytes = this.config.fetchBytes ?? mustFetchBytes(image);
    const payload = await resolveImage(image, fetchBytes);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            toContentBlock(payload),
            { type: 'text', text: 'הוצא את נתוני ההזמנה כ-JSON לפי הסכמה.' },
          ],
        },
      ],
    });

    const text = joinTextBlocks(response.content);
    const ex = PoExtraction.parse(parseJsonFromText(text));
    return mapExtractionToNormalized(ex, this.config.platform as PlatformId);
  }
}

/**
 * Test/pilot parser: returns a fixed extraction (or NormalizedPurchaseOrder),
 * so the import orchestration can be exercised without calling Anthropic — the
 * same gate the invoice pipeline uses via StubOcrProvider.
 */
export class StubPoParser implements PoDocumentParser {
  private readonly normalized: NormalizedPurchaseOrder;
  constructor(fixture: PoExtraction | NormalizedPurchaseOrder, platform: PlatformId = 'zestt') {
    // NormalizedPurchaseOrder has a `platform` field; a raw PoExtraction does not.
    this.normalized =
      'platform' in fixture
        ? (fixture as NormalizedPurchaseOrder)
        : mapExtractionToNormalized(fixture, platform);
  }
  async parse(_image: ImageSource): Promise<NormalizedPurchaseOrder> {
    return this.normalized;
  }
}
