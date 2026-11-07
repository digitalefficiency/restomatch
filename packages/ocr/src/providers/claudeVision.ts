/**
 * Anthropic Claude Vision provider — real implementation.
 *
 * Sends the invoice image/PDF to Claude with a Hebrew-invoice extraction prompt
 * and parses the JSON response into the v2 extraction (./invoiceSchema). Every
 * OCR digit can become a ₪ "leak", so a failed or doubtful read is a typed,
 * REVIEWABLE failure (../errors) — never a silent partial invoice.
 *
 * CREDENTIAL GATE (AGENTS.md): instantiating this class needs a real
 * ANTHROPIC_API_KEY. The worker only constructs it when the key is present.
 *
 * The SDK is imported LAZILY (dynamic import inside extract) and typed loosely,
 * so this package typechecks and the unit tests run even when
 * `@anthropic-ai/sdk` is not installed in the sandbox.
 */

import { OcrExtractionError, type OcrUsage } from '../errors';
import type { ImageSource, OcrProvider } from '../types';
import {
  joinTextBlocks,
  mustFetchBytes,
  parseJsonFromText,
  resolveImage,
  toContentBlock,
} from './_anthropic';
import { InvoiceExtractionV2 } from './invoiceSchema';
import { normalizeExtraction } from './normalizeExtraction';

/** The OCR default (invoice + PO). OCR_CLAUDE_MODEL overrides it. */
export const DEFAULT_OCR_MODEL = 'claude-opus-5-5';
/** Extraction is vision + JSON, not open-ended reasoning: `low` unless OCR_CLAUDE_EFFORT says otherwise. */
export const DEFAULT_OCR_EFFORT: OcrEffort = 'low';
/**
 * Per-request cap. A read takes well under a minute at low effort; the SDK
 * default (10 min, 2 retries) could hold a Vercel function far past its limit.
 * Override with OCR_CLAUDE_TIMEOUT_MS.
 */
export const DEFAULT_OCR_TIMEOUT_MS = 90_000;
export const OCR_MAX_RETRIES = 1;

export interface ClaudeVisionConfig {
  apiKey: string;
  /** Claude model id. Falls back to OCR_CLAUDE_MODEL env, then DEFAULT_OCR_MODEL. */
  model?: string;
  /** Output cap; invoices with many lines need headroom. Defaults to 16000. */
  maxTokens?: number;
  /**
   * When true, fetch the image bytes ourselves and send base64 instead of
   * handing Claude a URL. Required when the scan bucket is private. Auto-enabled
   * for non-http sources.
   */
  fetchBytes?: boolean;
  /** `output_config.effort`. Falls back to OCR_CLAUDE_EFFORT, then DEFAULT_OCR_EFFORT ('low'). */
  effort?: OcrEffort;
  /** Request timeout in ms. Falls back to OCR_CLAUDE_TIMEOUT_MS, then DEFAULT_OCR_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Called with the API usage of each call (benchmark cost accounting). */
  onUsage?: (usage: { input_tokens?: number; output_tokens?: number }) => void;
}

export type OcrEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly OcrEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** What extract() adds next to the invoice: the call's cost and duration. */
export interface ExtractionMeta {
  model: string;
  effort: OcrEffort;
  usage: OcrUsage;
  elapsedMs: number;
}

export type ClaudeInvoiceExtraction = InvoiceExtractionV2 & { meta: ExtractionMeta };

/** @deprecated v1 name; the v2 schema keeps the per-line English rendering. */
export const InvoiceOcrResultWithEnglish = InvoiceExtractionV2;

const DEFAULT_MAX_TOKENS = 16000;

export function ocrTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.OCR_CLAUDE_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OCR_TIMEOUT_MS;
}

export const SYSTEM_PROMPT = `אתה מומחה לקריאת מסמכי ספקים עבריים של מסעדה (חשבוניות, תעודות משלוח, זיכויים). כל ספרה שתקרא עלולה להפוך ל"דליפה" בשקלים, לכן דיוק עדיף על שלמות: מה שלא קריא — השאר ריק או null, אל תנחש.

החזר JSON אחד בלבד, בפורמט הזה בדיוק:
{
  "documentKind": "tax_invoice" | "tax_invoice_receipt" | "credit_note" | "delivery_note" | "consolidated" | "receipt" | "quote" | "other",
  "supplier": { "name": string, "businessId": string?, "phone": string?, "contacts": [{ "role": string, "name": string?, "phone": string? }]? },
  "buyer": { "name": string?, "businessId": string? },
  "invoiceNumber": string,
  "invoiceDate": "YYYY-MM-DD",
  "allocationNumber": string | null,
  "deliveryNotes": [{ "number": string, "date": "YYYY-MM-DD"? }],
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "lines": [{ "sku": string?, "rawDescription": string, "rawDescriptionEn": string, "lineKind": "item" | "deposit" | "delivery_fee", "qty": number, "unit": string, "unitPrice": number, "lineDiscountPct": number?, "lineTotal": number, "vatRate": number?, "confidence": number? }],
  "invoiceDiscount": number | null,
  "totals": { "subtotal": number, "vatRate": number?, "vat": number, "total": number },
  "continuesOnAnotherPage": boolean,
  "handwrittenCorrection": boolean,
  "confidence": number?
}

סוג המסמך ("documentKind"):
- "חשבונית מס" = tax_invoice; "חשבונית מס קבלה" = tax_invoice_receipt; "חשבונית זיכוי" / "זיכוי" = credit_note; "תעודת משלוח" = delivery_note; "חשבונית מרכזת" (מרכזת כמה תעודות משלוח) = consolidated; "קבלה" = receipt; "הצעת מחיר" = quote; אחרת other.

צדדים:
- "supplier" = מי שהנפיק את המסמך (בכותרת, ליד ח.פ./ע.מ.). "businessId" = מספר ח.פ./ע.מ. של הספק כפי שמודפס, ספרות בלבד.
- "buyer" = הלקוח ("לכבוד", "שם הלקוח") ומספר העוסק שלו אם מופיע. אל תחליף בין ספק ללקוח.
- "contacts" = כל איש קשר מודפס: מנהל אזור / סוכן / מנהל תיק לקוח / נהג — role בעברית, name וטלפון אם מופיע. "phone" ברמת supplier = הטלפון הראשי של הספק.
- "allocationNumber" = "מספר הקצאה" אם מופיע, ספרות בלבד.

חשבונית מרכזת: "deliveryNotes" = כל תעודות המשלוח שהיא מרכזת (מספר ותאריך); "periodStart"/"periodEnd" = התקופה המודפסת. במסמך אחר — רשימה ריקה ו-null.

שורות:
- שורה אחת לכל שורת פריט מודפסת, בסדר המודפס. "sku" = המק״ט של הספק כפי שמודפס; אם אין — השמט.
- "rawDescription" בעברית המקורית. "rawDescriptionEn" = תרגום קצר לאנגלית בסגנון קטלוג מכולת ("Chicken breast, fresh", "Olive oil 1 L") לעובד שאינו קורא עברית; מותגים בתעתיק לטיני, מידות/משקלים/אחוזים/קודים בדיוק כמו במקור.
- "unit" בעברית כפי שמופיע (ק״ג / יח׳ / ארגז / וכו').
- "unitPrice" = המחיר ליחידה נטו, אחרי הנחת השורה. אם מודפסת הנחה לשורה — "lineDiscountPct" באחוזים (10 = 10%).
- "lineTotal" = סכום השורה כפי שמודפס (לפני מע״מ אם החשבונית מציגה כך).
- "lineKind": "deposit" לפיקדון (בקבוקים/ארגזים/משטחים), "delivery_fee" לדמי משלוח/הובלה, אחרת "item".
- "vatRate" בשורה = שבר עשרוני (0.18), רק אם מודפס לשורה. פירות וירקות טריים פטורים לרוב (מע״מ 0%) — אז 0.

סכומים:
- "invoiceDiscount" = הנחה כללית בשקלים ברמת החשבונית (לפני מע״מ), אם מודפסת.
- "totals": "subtotal" = סה״כ לפני מע״מ, "vatRate" = שיעור המע״מ המודפס כשבר (0.18), "vat" = סכום המע״מ, "total" = סה״כ לתשלום — כולם כפי שמודפסים. אל תחשב בעצמך במקום לקרוא; אם הסכומים לא מסתדרים — העתק את המודפס, המערכת תבדוק.
- כל הסכומים מספרים (לא מחרוזות), נקודה עשרונית, בלי ₪ ובלי פסיקי אלפים.

דגלים:
- "continuesOnAnotherPage" = true אם המסמך ממשיך בעמוד שלא נמצא כאן ("המשך בעמוד הבא", "עמוד 1 מתוך 2", אין סה״כ בסוף).
- "handwrittenCorrection" = true אם יש תיקון בכתב יד על כמות, מחיר או סכום (מחיקה, ספרה שנכתבה מעל, חתימה ליד תיקון).
- "confidence" = רמת הביטחון שלך (0..1), ברמת המסמך וגם לכל שורה. ספרה מטושטשת, קפל, צל או כתב יד — ערך נמוך.

החזר JSON בלבד, ללא טקסט נוסף, ללא code fences.`;

export class ClaudeVision implements OcrProvider {
  readonly id = 'claude_vision' as const;

  constructor(private readonly config: ClaudeVisionConfig) {}

  get model(): string {
    return this.config.model ?? process.env.OCR_CLAUDE_MODEL ?? DEFAULT_OCR_MODEL;
  }

  get effort(): OcrEffort {
    const e = this.config.effort ?? process.env.OCR_CLAUDE_EFFORT;
    return EFFORTS.includes(e as OcrEffort) ? (e as OcrEffort) : DEFAULT_OCR_EFFORT;
  }

  async extract(image: ImageSource): Promise<ClaudeInvoiceExtraction> {
    // LAZY import: keeps the package typecheck/test green when the SDK isn't
    // fetched in the sandbox. Typed loosely (any) on purpose (SDK 0.69).
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as { default: any };
    const client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeoutMs ?? ocrTimeoutMs(),
      maxRetries: OCR_MAX_RETRIES,
    });

    const fetchBytes = this.config.fetchBytes ?? mustFetchBytes(image);
    const payload = await resolveImage(image, fetchBytes);

    const model = this.model;
    const effort = this.effort;
    const t0 = Date.now();
    // No assistant prefill (400 on the current models) and no `thinking` field:
    // Opus 5.5 always thinks and effort is its only control; thinking blocks in
    // the answer are skipped by joinTextBlocks. Effort is ALWAYS sent — Opus
    // 5.5 would otherwise default to medium.
    const response = await client.messages.create({
      model,
      max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      output_config: { effort },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            toContentBlock(payload),
            { type: 'text', text: 'הוצא את נתוני המסמך כ-JSON לפי הסכמה.' },
          ],
        },
      ],
    });
    const elapsedMs = Date.now() - t0;
    this.config.onUsage?.(response.usage ?? {});
    const usage: OcrUsage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };

    if (response.stop_reason === 'max_tokens') {
      throw new OcrExtractionError('max_tokens', 'the answer was cut off at max_tokens', { usage, elapsedMs });
    }
    if (response.stop_reason === 'refusal') {
      const refusalCategory = (response.stop_details?.category as string | null | undefined) ?? null;
      throw new OcrExtractionError('refusal', `the model declined (category: ${refusalCategory ?? 'none'})`, {
        usage,
        elapsedMs,
        refusalCategory,
      });
    }

    const json = parseJsonFromText(joinTextBlocks(response.content));
    const parsed = InvoiceExtractionV2.safeParse(normalizeExtraction(json));
    if (!parsed.success) {
      // Field paths only — never the values (they are invoice content).
      const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].slice(0, 5).join(', ');
      throw new OcrExtractionError('invalid_output', `the JSON does not match the invoice schema (${paths})`, {
        usage,
        elapsedMs,
      });
    }
    return { ...parsed.data, meta: { model, effort, usage, elapsedMs } };
  }
}
