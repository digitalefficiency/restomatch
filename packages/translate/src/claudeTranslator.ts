/**
 * Claude batch translator for item names the glossary can't handle.
 *
 * ONE request per batch (≤ maxBatch names), strict JSON via structured outputs,
 * a hard timeout, and no retries beyond one — the caller (CompositeTranslator)
 * treats any failure as "no translation" and falls back to the Hebrew original.
 *
 * The SDK is imported lazily (like packages/ocr) so this package typechecks and
 * its tests run without network; tests inject `client`.
 */
import { z } from 'zod';

/** Fast, cheap current model — names are short, the task is simple. */
export const DEFAULT_TRANSLATE_MODEL = 'claude-haiku-5-5';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BATCH = 80;

export const TRANSLATE_SYSTEM_PROMPT = `You translate Israeli restaurant-supplier invoice and purchase-order line items from Hebrew to English.
The English is read by a kitchen receiving worker (often not a native Hebrew or English speaker) who checks a delivery against the paper invoice.

Rules:
- Short grocery/catalog-style English, e.g. "Chicken breast, fresh", "Cherry tomatoes", "Olive oil 1 L". No sentences, no explanations.
- Keep brand names, product codes, numbers, sizes, weights and percentages exactly (e.g. "Tnuva", "3%", "1.5 L", "x12"). Transliterate Hebrew brand names (תנובה → Tnuva).
- Translate units: ק"ג → kg, גרם/גר' → g, ליטר/ל' → L, מ"ל → ml, יח' → unit, ארגז → case, קרטון → carton, מארז → pack.
- Keep meat cuts and fish species specific (אנטריקוט → entrecote, פרגית → boneless chicken thigh, דניס → sea bream, לברק → sea bass).
- If a line is already English, return it unchanged. If a line is not a product (e.g. "הנחה" → "Discount", "דמי משלוח" → "Delivery fee"), translate it plainly.
- Return every input id exactly once.`;

const ResponseSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), en: z.string() })),
});

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, en: { type: 'string' } },
        required: ['id', 'en'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

/** The slice of the Anthropic client we use (lets tests inject a fake). */
export interface MessagesClientLike {
  messages: {
    create(body: Record<string, unknown>, opts?: { timeout?: number; signal?: AbortSignal }): Promise<{
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
    }>;
  };
}

export interface ClaudeTranslatorConfig {
  apiKey?: string;
  /** Model id; falls back to TRANSLATE_CLAUDE_MODEL env, then claude-haiku-5-5. */
  model?: string;
  timeoutMs?: number;
  maxBatch?: number;
  /** Test seam: a pre-built client (no SDK import, no network). */
  client?: MessagesClientLike;
}

export class ClaudeTranslator {
  private clientPromise: Promise<MessagesClientLike> | null = null;

  constructor(private readonly config: ClaudeTranslatorConfig) {}

  get model(): string {
    return this.config.model ?? process.env.TRANSLATE_CLAUDE_MODEL ?? DEFAULT_TRANSLATE_MODEL;
  }

  private async client(): Promise<MessagesClientLike> {
    if (this.config.client) return this.config.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as { default: any };
        return new Anthropic({
          apiKey: this.config.apiKey,
          timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxRetries: 1,
        }) as MessagesClientLike;
      })();
    }
    return this.clientPromise;
  }

  /**
   * Translate unique Hebrew names. Returns a Map(original → English) holding
   * only the names Claude answered for. Throws on transport / parse errors.
   */
  async translateBatch(texts: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
    const out = new Map<string, string>();
    const size = this.config.maxBatch ?? DEFAULT_MAX_BATCH;
    for (let start = 0; start < unique.length; start += size) {
      const chunk = unique.slice(start, start + size);
      const answered = await this.translateChunk(chunk);
      for (const [k, v] of answered) out.set(k, v);
    }
    return out;
  }

  private async translateChunk(chunk: string[]): Promise<Map<string, string>> {
    const client = await this.client();
    const payload = chunk.map((text, id) => ({ id, he: text }));
    const response = await client.messages.create(
      {
        model: this.model,
        max_tokens: Math.min(16000, 400 + chunk.length * 60),
        // EN-8: Haiku 5.5 thinks adaptively by default; for short lookups that
        // only burns the small output budget and can truncate the JSON.
        // Disabling is accepted at Haiku's default (medium) effort.
        thinking: { type: 'disabled' },
        system: TRANSLATE_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: JSON_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: `Translate each "he" to English. Input JSON:\n${JSON.stringify(payload)}`,
          },
        ],
      },
      { timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    if (response.stop_reason === 'max_tokens') {
      // Truncated JSON is a retryable miss, not a parse error: split the batch
      // and retry the halves; a single name that still overflows throws, which
      // the composite treats as a short back-off (retried later).
      if (chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        const [a, b] = await Promise.all([
          this.translateChunk(chunk.slice(0, mid)),
          this.translateChunk(chunk.slice(mid)),
        ]);
        return new Map([...a, ...b]);
      }
      throw new Error('translation truncated (max_tokens)');
    }
    if (response.stop_reason === 'refusal') {
      throw new Error('translation refused');
    }
    const text = response.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const parsed = ResponseSchema.parse(JSON.parse(text));
    const out = new Map<string, string>();
    for (const item of parsed.items) {
      const source = chunk[item.id];
      const en = item.en.trim();
      if (source !== undefined && en !== '' && en.length <= 300) out.set(source, en);
    }
    return out;
  }
}
