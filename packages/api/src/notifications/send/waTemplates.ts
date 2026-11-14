/**
 * WhatsApp utility templates (H-05). Meta rejects free text outside the 24 h
 * customer-service window, so every business-initiated WhatsApp goes out as a
 * pre-approved template. These are the bodies a human submits to Meta
 * (Phase-6); until they are approved and the token exists, the dispatcher
 * parks the row `skipped_no_provider`.
 *
 * A producer puts `{ name, params, recipientRole? }` under the outbox row's
 * `payload.__waTemplate` (`waTemplatePayload()`); the send path validates and
 * builds the Graph API body here. There is no free-text fallback: an unknown
 * template or a missing parameter is rejected, never sent as plain text.
 *
 * Supplier-facing wording follows docs/ux/terms/GLOSSARY.md §1–§2 (owner,
 * 7.11): "בקשת זיכוי" / "מכתב בקשת זיכוי", ask don't demand, "תזכורת קטנה";
 * never דרישה / תביעה / מחלוקת / חוב / באיחור.
 */
import type { UserRole } from '@restomatch/db';

export type WaTemplateName =
  | 'rm_decision_needed'
  | 'rm_delivery_late'
  | 'rm_claim_reply'
  | 'rm_claim_letter'
  | 'rm_claim_reminder';

export interface WaTemplateParam {
  key: string;
  /** A ₪ value. Never rendered for a role without money view (receiver; chef outside orders/recipes). */
  money?: boolean;
}

export interface WaTemplateSpec {
  name: WaTemplateName;
  /** Who receives it: our own staff, or a supplier (partner wording applies). */
  audience: 'staff' | 'supplier';
  /** Meta category. All five are utility (transactional), never marketing. */
  category: 'UTILITY';
  language: 'he';
  /** Ordered body parameters ({{1}}, {{2}}, …). */
  params: readonly WaTemplateParam[];
  /** The body text submitted to Meta, with {{n}} placeholders. */
  bodyHe: string;
}

export const WA_TEMPLATES: Readonly<Record<WaTemplateName, WaTemplateSpec>> = {
  rm_decision_needed: {
    name: 'rm_decision_needed',
    audience: 'staff',
    category: 'UTILITY',
    language: 'he',
    params: [{ key: 'supplier' }, { key: 'amount', money: true }, { key: 'link' }],
    bodyHe: 'חשבונית מ{{1}} ממתינה להחלטה שלך לפני תשלום: {{2}}. לפתיחה: {{3}}',
  },
  rm_delivery_late: {
    name: 'rm_delivery_late',
    audience: 'staff',
    category: 'UTILITY',
    language: 'he',
    params: [{ key: 'supplier' }, { key: 'expected' }, { key: 'link' }],
    bodyHe: 'המשלוח מ{{1}} עדיין לא הגיע (היה צפוי {{2}}). לפרטים: {{3}}',
  },
  rm_claim_reply: {
    name: 'rm_claim_reply',
    audience: 'staff',
    category: 'UTILITY',
    language: 'he',
    params: [{ key: 'supplier' }, { key: 'sentOn' }, { key: 'link' }],
    bodyHe: '{{1}} ענה על בקשת הזיכוי מ-{{2}}. לצפייה בתשובה: {{3}}',
  },
  rm_claim_letter: {
    name: 'rm_claim_letter',
    audience: 'supplier',
    category: 'UTILITY',
    language: 'he',
    params: [{ key: 'contact' }, { key: 'restaurant' }, { key: 'month' }, { key: 'link' }],
    bodyHe:
      'שלום {{1}}, מצורף מכתב בקשת זיכוי מ{{2}} על פערים בחשבוניות {{3}}. ' +
      'נשמח לחשבונית זיכוי, או לעדכון אם משהו לא מסתדר. למכתב: {{4}}. תודה!',
  },
  rm_claim_reminder: {
    name: 'rm_claim_reminder',
    audience: 'supplier',
    category: 'UTILITY',
    language: 'he',
    params: [{ key: 'contact' }, { key: 'sentOn' }, { key: 'restaurant' }, { key: 'link' }],
    bodyHe:
      'שלום {{1}}, תזכורת קטנה לגבי בקשת הזיכוי ששלחנו ב-{{2}} מ{{3}}. ' +
      'נשמח לחשבונית זיכוי, או שנבדוק יחד אם צריך: {{4}}. תודה!',
  },
};

/** What a producer stores under `payload.__waTemplate`. */
export interface WaTemplateRequest {
  name: WaTemplateName;
  params: Record<string, string>;
  /** The recipient's role when the recipient is a member (G-06 `payload.role`). */
  recipientRole?: UserRole;
}

/** Non-retryable: the row is wrong, a retry cannot fix it. */
export class WaTemplateError extends Error {
  constructor(
    readonly code: 'UNKNOWN_TEMPLATE' | 'MISSING_PARAM' | 'BAD_PARAM' | 'MONEY_FOR_NO_MONEY_ROLE' | 'BAD_TARGET',
    message: string,
  ) {
    super(message);
    this.name = 'WaTemplateError';
  }
}

/** Roles that never see ₪ in a WhatsApp alert (decision 6; G-06 `canSeeMoney`, general scope). */
const NO_MONEY_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['receiver', 'chef']);

/** Build the payload fragment a producer stores (`{ __waTemplate: … }`). */
export function waTemplatePayload(req: WaTemplateRequest): { __waTemplate: WaTemplateRequest } {
  validateTemplateRequest(req);
  return { __waTemplate: req };
}

/** Read `payload.__waTemplate` (null when the row is not a template row). */
export function readWaTemplate(payload: Record<string, unknown> | null | undefined): WaTemplateRequest | null {
  const raw = payload?.__waTemplate;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<WaTemplateRequest>;
  if (typeof r.name !== 'string' || !r.params || typeof r.params !== 'object') {
    throw new WaTemplateError('UNKNOWN_TEMPLATE', 'payload.__waTemplate is malformed');
  }
  return r as WaTemplateRequest;
}

/**
 * Meta's rules for a body parameter: non-empty, no newline or tab, no more than
 * four consecutive spaces, at most 1024 characters.
 */
function checkParam(name: string, key: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WaTemplateError('MISSING_PARAM', `${name}: parameter "${key}" is missing`);
  }
  if (/[\n\r\t]/.test(value) || / {5,}/.test(value) || value.length > 1024) {
    throw new WaTemplateError('BAD_PARAM', `${name}: parameter "${key}" breaks Meta's parameter rules`);
  }
  return value;
}

export function validateTemplateRequest(req: WaTemplateRequest): WaTemplateSpec {
  const spec = (WA_TEMPLATES as Record<string, WaTemplateSpec | undefined>)[req.name];
  if (!spec) throw new WaTemplateError('UNKNOWN_TEMPLATE', `unknown WhatsApp template "${req.name}"`);
  for (const p of spec.params) {
    checkParam(spec.name, p.key, req.params[p.key]);
    if (p.money && req.recipientRole && NO_MONEY_ROLES.has(req.recipientRole)) {
      throw new WaTemplateError(
        'MONEY_FOR_NO_MONEY_ROLE',
        `${spec.name}: a ₪ parameter cannot go to a ${req.recipientRole}`,
      );
    }
  }
  return spec;
}

/** WhatsApp `to`: E.164 digits without '+'. A `role:` target is never a phone. */
export function waRecipient(target: string): string {
  const t = target.trim();
  if (!/^\+?[1-9]\d{7,14}$/.test(t)) {
    throw new WaTemplateError('BAD_TARGET', 'WhatsApp target is not an E.164 phone number');
  }
  return t.replace(/^\+/, '');
}

/** The Graph API `/messages` body for a template message. */
export function buildTemplateMessage(target: string, req: WaTemplateRequest) {
  const spec = validateTemplateRequest(req);
  return {
    messaging_product: 'whatsapp' as const,
    to: waRecipient(target),
    type: 'template' as const,
    template: {
      name: spec.name,
      language: { code: spec.language },
      components: [
        {
          type: 'body' as const,
          parameters: spec.params.map((p) => ({ type: 'text' as const, text: req.params[p.key]! })),
        },
      ],
    },
  };
}

/** Local preview of what the recipient will read (tests, admin preview). */
export function renderTemplatePreview(req: WaTemplateRequest): string {
  const spec = validateTemplateRequest(req);
  return spec.bodyHe.replace(/\{\{(\d+)\}\}/g, (_, n: string) => req.params[spec.params[Number(n) - 1]!.key]!);
}
