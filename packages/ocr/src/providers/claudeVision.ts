/**
 * Anthropic Claude Vision provider — production scaffold.
 *
 * VERIFY: pending real credentials. When ANTHROPIC_API_KEY is set:
 *   `npm i @anthropic-ai/sdk` before enabling.
 *
 * Strategy: send the image as a content block to Claude with a JSON-output
 * system prompt that defines the InvoiceOcrResult schema. Claude excels at
 * Hebrew line-item extraction, especially handwritten or noisy scans.
 */

import type { InvoiceOcrResult } from '@restomatch/types';
import type { ImageSource, OcrProvider } from '../types';

export interface ClaudeVisionConfig {
  apiKey: string;
  /** Claude model id, e.g. "claude-sonnet-4-6" */
  model: string;
}

const SYSTEM_PROMPT = `אתה מומחה לקריאת חשבוניות עבריות. הוצא JSON בפורמט הבא:
{
  "supplier": { "name": string, "businessId": string? },
  "invoiceNumber": string,
  "invoiceDate": "YYYY-MM-DD",
  "allocationNumber": string | null,
  "lines": [{ "rawDescription": string, "qty": number, "unit": string, "unitPrice": number, "lineTotal": number, "vatRate": number? }],
  "totals": { "subtotal": number, "vat": number, "total": number }
}

חוקים:
- אם שדה לא קריא — השאר ריק או null, אל תנחש.
- "unit" בעברית כפי שמופיע (ק״ג / יח׳ / חבילה / וכו').
- חוקי מע״מ ישראליים: בודק שה-VAT = subtotal * 0.17 בעברית.
- אם יש "מספר הקצאה" — שמור אותו ב-allocationNumber.

החזר JSON בלבד, ללא טקסט נוסף.`;

export class ClaudeVision implements OcrProvider {
  readonly id = 'claude_vision' as const;

  constructor(private readonly config: ClaudeVisionConfig) {}

  async extract(_image: ImageSource): Promise<InvoiceOcrResult> {
    // VERIFY: implementation pending — uses @anthropic-ai/sdk
    // Pseudocode:
    //   const client = new Anthropic({ apiKey: this.config.apiKey });
    //   const response = await client.messages.create({
    //     model: this.config.model,
    //     max_tokens: 4096,
    //     system: SYSTEM_PROMPT,
    //     messages: [{
    //       role: 'user',
    //       content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }],
    //     }],
    //   });
    //   const json = response.content[0].text;
    //   return InvoiceOcrResult.parse(JSON.parse(json));
    void SYSTEM_PROMPT;
    throw new Error(
      `ClaudeVision not yet wired — install @anthropic-ai/sdk and implement extract(). ` +
        `Model: ${this.config.model}`,
    );
  }
}
