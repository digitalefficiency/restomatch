/**
 * Anthropic Claude Vision provider — real implementation.
 *
 * Sends the invoice image/PDF to Claude with a Hebrew-invoice extraction prompt
 * and parses the JSON response into InvoiceOcrResult. Claude excels at Hebrew
 * line-item extraction, including handwritten or noisy scans.
 *
 * CREDENTIAL GATE (AGENTS.md): instantiating this class needs a real
 * ANTHROPIC_API_KEY. Ingest must stay on StubOcrProvider until keys AND
 * Supabase/RLS are live (Phase-6). The worker only constructs this when the key
 * is present; otherwise it fails loudly rather than running an un-isolated real
 * ingest.
 *
 * The SDK is imported LAZILY (dynamic import inside extract) and typed loosely,
 * so this package typechecks and the unit tests run even when
 * `@anthropic-ai/sdk` is not installed in the sandbox. The dependency is
 * declared in package.json; install is owned by the foundation agent.
 */

import { InvoiceOcrLine, InvoiceOcrResult } from '@restomatch/types';
import { z } from 'zod';
import type { ImageSource, OcrProvider } from '../types';
import {
  joinTextBlocks,
  mustFetchBytes,
  parseJsonFromText,
  resolveImage,
  toContentBlock,
} from './_anthropic';
import { normalizeExtraction } from './normalizeExtraction';

export interface ClaudeVisionConfig {
  apiKey: string;
  /**
   * Claude model id. Falls back to OCR_CLAUDE_MODEL env, then 'claude-opus-4-8'.
   */
  model?: string;
  /** Output cap; invoices with many lines need headroom. Defaults to 16000. */
  maxTokens?: number;
  /**
   * When true, fetch the image bytes ourselves and send base64 instead of
   * handing Claude a URL. Required when the scan bucket is private (Anthropic
   * cannot fetch a signed/expiring URL reliably). Auto-enabled for non-http
   * sources. Defaults to false (let Anthropic fetch public URLs).
   */
  fetchBytes?: boolean;
  /**
   * Optional `output_config.effort`. Falls back to OCR_CLAUDE_EFFORT; unset =
   * not sent (the model's own default). Lower effort is the main latency lever
   * on the current models — see docs/OCR-MODEL-BENCHMARK.md.
   */
  effort?: OcrEffort;
  /** Called with the API usage of each call (benchmark cost accounting). */
  onUsage?: (usage: { input_tokens?: number; output_tokens?: number }) => void;
}

export type OcrEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly OcrEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * The canonical schema plus the per-line English rendering ("Receiver in
 * English") that the same call returns — zero extra spend. zod would strip an
 * unknown key, so we extend rather than parse with the bare InvoiceOcrResult.
 */
export const InvoiceOcrResultWithEnglish = InvoiceOcrResult.extend({
  lines: z.array(
    InvoiceOcrLine.extend({
      rawDescriptionEn: z
        .string()
        .nullable()
        .optional()
        .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
    }),
  ),
});
const DEFAULT_MAX_TOKENS = 16000;

const SYSTEM_PROMPT = `אתה מומחה לקריאת חשבוניות עבריות. הוצא JSON בפורמט הבא בדיוק:
{
  "supplier": { "name": string, "businessId": string?, "phone": string?, "contacts": [{ "role": string, "name": string?, "phone": string? }]? },
  "invoiceNumber": string,
  "invoiceDate": "YYYY-MM-DD",
  "allocationNumber": string | null,
  "lines": [{ "sku": string?, "rawDescription": string, "rawDescriptionEn": string, "qty": number, "unit": string, "unitPrice": number, "lineTotal": number, "vatRate": number?, "confidence": number? }],
  "totals": { "subtotal": number, "vat": number, "total": number },
  "confidence": number?
}

חוקים:
- אם שדה לא קריא — השאר ריק או null, אל תנחש.
- "rawDescriptionEn" = תרגום קצר לאנגלית של שם הפריט, בסגנון קטלוג מכולת ("Chicken breast, fresh", "Cherry tomatoes", "Olive oil 1 L"), עבור עובד קבלת סחורה שאינו קורא עברית. שמור שמות מותגים (בתעתיק לטיני), מידות, משקלים, אחוזים וקודים בדיוק כפי שהם; נתחי בשר וסוגי דגים — במדויק. "rawDescription" נשאר בעברית המקורית.
- "unit" בעברית כפי שמופיע (ק״ג / יח׳ / חבילה / וכו').
- מע״מ ישראלי: בדוק שה-vat ≈ subtotal × שיעור המע״מ; אם לא, העדף את הסכומים המודפסים על החשבונית.
- "contacts" = כל איש קשר מודפס על החשבונית: מנהל אזור / סוכן / מנהל תיק לקוח / נהג. לכל אחד role (התפקיד בעברית), name וטלפון אם מופיע. "phone" ברמת supplier = טלפון ראשי של הספק אם מופיע.
- "sku" = מספר הפריט/המק״ט אצל הספק (עמודת "מק״ט"), כפי שמודפס. אם אין — השמט.
- אם יש "מספר הקצאה" — שמור אותו ב-allocationNumber.
- כל הסכומים מספריים (לא מחרוזות), נקודה עשרונית.
- "confidence" = רמת הביטחון שלך (0..1), ברמת החשבונית וגם פר-שורה. אם אינך בטוח — תן ערך נמוך.

החזר JSON בלבד, ללא טקסט נוסף, ללא code fences.`;

export class ClaudeVision implements OcrProvider {
  readonly id = 'claude_vision' as const;

  constructor(private readonly config: ClaudeVisionConfig) {}

  private get model(): string {
    return this.config.model ?? process.env.OCR_CLAUDE_MODEL ?? DEFAULT_MODEL;
  }

  private get effort(): OcrEffort | undefined {
    const e = this.config.effort ?? process.env.OCR_CLAUDE_EFFORT;
    return EFFORTS.includes(e as OcrEffort) ? (e as OcrEffort) : undefined;
  }

  async extract(image: ImageSource): Promise<InvoiceOcrResult> {
    // LAZY import: keeps the package typecheck/test green when the SDK isn't
    // fetched in the sandbox. Typed loosely (any) on purpose.
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as { default: any };
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const fetchBytes = this.config.fetchBytes ?? mustFetchBytes(image);
    const payload = await resolveImage(image, fetchBytes);

    // No assistant prefill — opus-4-8 returns 400 on prefilled assistant turns.
    // We instruct JSON-only in the system prompt and parse the text block.
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            toContentBlock(payload),
            { type: 'text', text: 'הוצא את נתוני החשבונית כ-JSON לפי הסכמה.' },
          ],
        },
      ],
    });

    this.config.onUsage?.(response.usage ?? {});
    const text = joinTextBlocks(response.content);

    // Parse, then validate against the canonical schema. On any parse/validation
    // failure we THROW so the BullMQ job retries — never silently emit a partial
    // invoice (no manufactured ₪). Model-reported confidence (top-level + per
    // line) flows through because InvoiceOcrResult preserves those fields.
    return InvoiceOcrResultWithEnglish.parse(normalizeExtraction(parseJsonFromText(text)));
  }
}
