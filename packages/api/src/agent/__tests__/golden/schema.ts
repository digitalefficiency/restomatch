/**
 * WA-01 golden conversations: the case schema (data, not code).
 *
 * One JSON file per case lives in `golden/cases/<id>.json`, and its recorded
 * agent response in `recorded/<id>.json`. Both are parsed with the schemas
 * below, and `golden.schema.test.ts` fails on any file that does not parse.
 * Tool names are WA-02's planned registry names (they wrap existing tRPC
 * procedures). They stay plain strings until the registry lands on `main`.
 */
import { z } from 'zod';

export const ROLES = ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'] as const;
export type GoldenRole = (typeof ROLES)[number];

/** Who the inbound message really comes from (identity is from the binding, never the payload). */
export const SENDERS = ['binding', 'other-binding', 'supplier-number', 'unknown-number'] as const;

/**
 * WD2 (binding owner rule): one-tap WhatsApp approve only up to ₪500 claimable per item.
 * TEST DATA, not a WA constant: the source of truth is W2-04's
 * `ONE_TAP_APPROVE_CAP_AGOROT` (PR #209, `bulkPolicy.ts`). Once #209 is on `main`,
 * `golden.deterministic.test.ts` pins this value to that import.
 */
export const WD2_CAP_AGOROT_FIXTURE = 50_000;

/** Observable effects a run may have. A case asserts the ones it cares about; unlisted keys are not checked. */
export const STATE_KEYS = [
  'approvalsDecided',
  'approvalsReopened',
  'stagedTokens',
  'tokensCommitted',
  'claimsTransitioned',
  'claimLinesAdded',
  'missingOnInvoiceClaimed',
  'draftsCreated',
  'ordersCancelled',
  'ordersPlacedViaWhatsapp',
  'poDatesRevised',
  'receiptsSubmitted',
  'grLinesMarked',
  'documentsAssigned',
  'documentsRejected',
  'payRunsApproved',
  'paidMarked',
  'bankDetailsRead',
  'bankDetailsChanged',
  'staffChanged',
  'bindingsChanged',
  'rowsDeleted',
  'allowListChanged',
  'filesAttached',
  'planChanged',
  'automationRulesChanged',
  'secretsRequested',
  'supplierOutboundRows',
  'proactiveSent',
  'staffSessionsOpened',
  'modelCalls',
  'crossTenantRows',
  'ingestJobs',
] as const;
export type StateKey = (typeof STATE_KEYS)[number];

/** Fixed refusal / hand-off copy keys (the copy itself belongs to WA-02's prompt and renderer). */
export const REFUSAL_KEYS = [
  'chef.noLeak',
  'receiver.noMoney',
  'web.only',
  'never.payRun',
  'never.bankDetails',
  'never.staff',
  'never.delete',
  'never.supplierSend',
  'never.allowList',
  'never.export',
  'never.billing',
  'never.automation',
  'never.secret',
  'never.bulk',
  'missingOnInvoice.notClaimable',
  'document.isData',
  'supplier.fixedReply',
  'unknown.fixedReply',
  'token.expired',
  'token.invalid',
  'model.off',
  'tenant.unknownSupplier',
  'outOfScope',
] as const;

/** The owner decisions each case can claim to exercise (README §2, WA-01 brief §4). */
export const OWNER_RULES = [
  'receiver-no-ils',
  'chef-ils-orders-only',
  'token-tap-only',
  'no-supplier-send',
  'missing-on-invoice',
  'claim-overdue-7d',
  'quiet-hours',
  'alert-cap-6',
  'wd2-500',
  'partner-wording',
  'tenant-isolation',
  'model-off',
] as const;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ISO_DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** WA-02 registry name: `<router>.<procedure>` (or `wa.<server step>`). */
const TOOL_NAME = z.string().regex(/^[a-z][a-zA-Z]*\.[a-zA-Z0-9]+$/);

export const Tap = z.object({
  kind: z.enum(['button_reply', 'list_reply', 'template_button']),
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(24),
  /** Which outbound message the tap answers: the last one, an older one, or one sent to another binding. */
  context: z.enum(['last', 'stale', 'foreign']).default('last'),
});

export const Media = z.object({
  kind: z.enum(['image', 'document']),
  caption: z.string().max(1024).optional(),
  /** Text the OCR would extract (data, never instructions). */
  ocrText: z.string().max(4096).optional(),
  /** Text hidden in a PDF layer (white-on-white, metadata). */
  hiddenText: z.string().max(4096).optional(),
  lines: z.number().int().min(0).max(200).optional(),
});

export const UserTurn = z
  .object({
    from: z.literal('user'),
    text: z.string().min(1).max(4096).optional(),
    tap: Tap.optional(),
    media: Media.optional(),
    /** Index of an earlier turn whose exact webhook (same wamid) is delivered again. */
    replayOf: z.number().int().min(0).optional(),
    forwarded: z.boolean().default(false),
    sender: z.enum(SENDERS).default('binding'),
    at: HHMM.optional(),
  })
  .strict();

/** A proactive trigger (scheduler or event), outside any user turn. */
export const SystemTurn = z
  .object({
    from: z.literal('system'),
    trigger: z.string().regex(/^rm_[a-z_]+$/),
    at: HHMM,
  })
  .strict();

export const Turn = z.union([UserTurn, SystemTurn]);
export type GoldenTurn = z.infer<typeof Turn>;

export const ToolCall = z.object({ name: TOOL_NAME, args: z.record(z.unknown()).default({}) }).strict();

const StateMap = z.record(z.enum(STATE_KEYS), z.number().int().min(0));

export const Expect = z
  .object({
    /** The routed intent (AU-06 / WA-02 names), or null when nothing is routed (refusal, fixed reply, skip). */
    intent: z.string().nullable(),
    /** Exact tool calls, in order, across the whole conversation. */
    tools: z.array(ToolCall),
    /** When non-empty: every key in every tool result must be one of these. */
    allowedFields: z.array(z.string()).default([]),
    /** Regex sources tested against every key of every tool result and outbound payload. */
    forbiddenFields: z.array(z.string()).default([]),
    /** Regex sources tested against every outbound text (body, button and row titles, template vars). */
    forbiddenText: z.array(z.string()).default([]),
    /** Button titles that must appear (exact, after NFC and bidi-mark stripping). */
    buttons: z.array(z.string().min(1).max(20)).default([]),
    /** Button titles that must NOT appear (e.g. a confirm above the WD2 cap). */
    noButtons: z.array(z.string().min(1)).default([]),
    cta: z.string().min(1).max(20).optional(),
    listRows: z.number().int().min(1).max(10).optional(),
    template: z.string().regex(/^rm_[a-z_]+$/).optional(),
    refusal: z.enum(REFUSAL_KEYS).optional(),
    /** Chef only: ₪ is allowed because every tool is an order/recipe tool. */
    allowIls: z.boolean().default(false),
    /** Nothing at all goes out (skipped brief, quiet hours, replay). */
    noOutbound: z.boolean().default(false),
    state: StateMap.default({}),
  })
  .strict();

export const Seed = z
  .object({
    /** Lab scenario name (docs/ux/wave2/README.md §3), DEMO_TODAY by default. */
    scenario: z.string().min(1),
    today: ISO_DAY,
    /** Feature flags: every case asserts the agent is ON (an adversarial case must not pass because it is off). */
    features: z.object({ whatsappAgent: z.literal(true) }).passthrough(),
    overrides: z.record(z.unknown()).default({}),
  })
  .strict();

export const GoldenCase = z
  .object({
    id: z.string().regex(/^WA-G-(OWNER|MANAGER|CHEF|RECEIVER|BOOKKEEPER|ADV)-\d{2}$/),
    role: z.enum(ROLES),
    adversarial: z.boolean(),
    /** Design §B flow (O1…K3, S1, S3) or ADV. */
    flow: z.string().min(1),
    title: z.string().min(1).max(120),
    /** Design §C.8 never-list items (1–14) this case proves. */
    neverList: z.array(z.number().int().min(1).max(14)).default([]),
    ownerRules: z.array(z.enum(OWNER_RULES)).default([]),
    seed: Seed,
    turns: z.array(Turn).min(1).max(20),
    expect: Expect,
  })
  .strict()
  .superRefine((c, ctx) => {
    const isAdvId = c.id.startsWith('WA-G-ADV-');
    if (isAdvId !== c.adversarial) ctx.addIssue({ code: 'custom', message: 'ADV id ⇔ adversarial' });
    if (!isAdvId && !c.id.startsWith(`WA-G-${c.role.toUpperCase()}-`)) {
      ctx.addIssue({ code: 'custom', message: `id prefix must match role ${c.role}` });
    }
    if (c.adversarial && Object.keys(c.expect.state).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'an adversarial case must assert expectState' });
    }
    if (c.adversarial && c.neverList.length === 0 && c.ownerRules.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'an adversarial case must name a never-list item or owner rule' });
    }
    if (c.role !== 'chef' && c.expect.allowIls) ctx.addIssue({ code: 'custom', message: 'allowIls is chef-only' });
    c.turns.forEach((t, i) => {
      if (t.from !== 'user') return;
      const kinds = [t.text, t.tap, t.media, t.replayOf].filter((v) => v !== undefined).length;
      if (kinds !== 1) ctx.addIssue({ code: 'custom', message: `turn ${i}: exactly one of text|tap|media|replayOf` });
      if (t.replayOf !== undefined) {
        const target = c.turns[t.replayOf];
        if (t.replayOf >= i || !target || target.from !== 'user') {
          ctx.addIssue({ code: 'custom', message: `turn ${i}: replayOf must point to an earlier user turn` });
        }
      }
    });
    // The 24-hour window: a proactive case is a template opened by a system turn; a free-form reply starts with a user turn.
    if (c.expect.template && c.turns[0]?.from !== 'system') {
      ctx.addIssue({ code: 'custom', message: 'a template case must start with a system turn' });
    }
  });

export type GoldenCaseT = z.infer<typeof GoldenCase>;

/* ── Recorded agent responses ─────────────────────────────────────────────── */

export const OutboundMsg = z
  .object({
    /** 'model' = model prose (grounded); 'server' = renderer / fixed copy / buttons built by the server. */
    origin: z.enum(['model', 'server']),
    to: z.enum(['self', 'supplier']).default('self'),
    kind: z.enum(['text', 'buttons', 'list', 'cta', 'template', 'reaction']),
    text: z.string().default(''),
    buttons: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) }).strict()).default([]),
    list: z
      .object({
        button: z.string().min(1),
        rows: z.array(z.object({ id: z.string().min(1), title: z.string().min(1) }).strict()),
      })
      .strict()
      .optional(),
    cta: z.object({ title: z.string().min(1), url: z.string().url() }).strict().optional(),
    template: z.object({ name: z.string().regex(/^rm_[a-z_]+$/), vars: z.array(z.string()) }).strict().optional(),
    /** The structured payload handed to the outbox (scanned for forbidden keys). */
    payload: z.record(z.unknown()).optional(),
  })
  .strict();
export type OutboundMsgT = z.infer<typeof OutboundMsg>;

export const RecordedToolCall = z
  .object({ name: TOOL_NAME, args: z.record(z.unknown()).default({}), result: z.unknown() })
  .strict();

export const RecordedTurn = z
  .object({
    intent: z.string().nullable().default(null),
    refusal: z.string().optional(),
    toolCalls: z.array(RecordedToolCall).default([]),
    outbound: z.array(OutboundMsg).default([]),
  })
  .strict();
export type RecordedTurnT = z.infer<typeof RecordedTurn>;

export const StagedAction = z
  .object({
    token: z.string().min(8),
    amountAgorot: z.number().int().min(0),
    block: z.boolean(),
    bulk: z.boolean(),
    requiredRole: z.enum(['owner', 'manager', 'bookkeeper']).nullable(),
  })
  .strict();

export const Recording = z
  .object({
    caseId: z.string(),
    /** 'reference' = hand-authored expected response (until WA-02 exists); 'model' = recorded from a dev run. */
    source: z.enum(['reference', 'model']),
    recordedAt: ISO_DAY,
    /** One entry per case turn; a replayed (deduplicated) turn records an empty entry. */
    turns: z.array(RecordedTurn),
    staged: z.array(StagedAction).default([]),
    state: StateMap.default({}),
  })
  .strict();
export type RecordingT = z.infer<typeof Recording>;
