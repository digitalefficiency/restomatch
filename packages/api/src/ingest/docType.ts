/**
 * W3-11 · Which kind of supplier document arrived in the inbox — pure.
 *
 * Slice a reads what the inbox already has (file name, e-mail subject). Slice b
 * feeds the OCR header text too, once the ocrInvoice.ts lock reaches W3-11; the
 * signature already takes it. The result is a SUGGESTION shown as a chip on the
 * inbox row; the user confirms it. Persisting the confirmed type needs a column
 * (`ingest_documents.doc_type`, H-04/H-13 addendum).
 *
 * Order matters: "חשבונית זיכוי" is a credit note before it is an invoice, and
 * "חשבונית מרכזת" is consolidated before it is an invoice.
 */

export const DOC_TYPES = ['credit_note', 'statement', 'consolidated', 'delivery_note', 'invoice'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocTypeSuggestion {
  type: DocType | null;
  /** high: an explicit document title; low: only a weak hint (e.g. a bare abbreviation). */
  confidence: 'high' | 'low';
}

const RULES: Array<{ type: DocType; strong: RegExp; weak?: RegExp }> = [
  {
    type: 'credit_note',
    strong: /(חשבונית|תעודת|הודעת)[\s_-]*זיכוי|credit[\s_-]*note/i,
    weak: /זיכוי|\bcredit\b|\bcn[\s_-]?\d/i,
  },
  {
    type: 'statement',
    strong: /כרטסת|כרטיס[\s_-]*(הנהלת[\s_-]*חשבונות|לקוח|חשבון)|דף[\s_-]*חשבון|statement[\s_-]*of[\s_-]*account/i,
    weak: /\bstatement\b|\bsoa\b/i,
  },
  {
    type: 'consolidated',
    strong: /חשבונית[\s_-]*(מס[\s_-]*)?(מרכזת|ריכוז)|חשבוניות[\s_-]*ריכוז|consolidated[\s_-]*invoice/i,
    weak: /מרכזת|ריכוז|consolidated/i,
  },
  {
    type: 'delivery_note',
    strong: /תעודת[\s_-]*משלוח|delivery[\s_-]*note/i,
    weak: /(^|[^\u0590-\u05FF])ת["״׳']מ(?![\u0590-\u05FF])|\bdn[\s_-]?\d/i,
  },
  {
    type: 'invoice',
    strong: /חשבונית[\s_-]*מס|tax[\s_-]*invoice/i,
    weak: /חשבונית|\binvoice\b|\binv[\s_-]?\d/i,
  },
];

export function classifyDocument(input: {
  filename?: string | null;
  subject?: string | null;
  /** OCR header text (slice b). */
  text?: string | null;
}): DocTypeSuggestion {
  const hay = [input.text, input.subject, input.filename].filter(Boolean).join(' \n ');
  if (!hay.trim()) return { type: null, confidence: 'low' };
  for (const r of RULES) if (r.strong.test(hay)) return { type: r.type, confidence: 'high' };
  for (const r of RULES) if (r.weak?.test(hay)) return { type: r.type, confidence: 'low' };
  return { type: null, confidence: 'low' };
}
