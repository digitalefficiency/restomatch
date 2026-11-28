/**
 * AU-01 · the catalogue of automations an owner can see and control.
 *
 * Pure data, no DB. Each row says what runs, when (an existing cron slot or an
 * event — never a new schedule), who receives it, whether the message carries
 * ₪, what switches it (a feature flag, an AU option in
 * `restaurants.settings.automations`, or nothing), and how to recognise its
 * runs in `notifications_outbox` for "last run" / "this week".
 *
 * The A-ids are the research catalogue ids (docs/ux/automation); AU-07 counts
 * KPI events by them. Copy (name / what / when / who) lives in the web i18n
 * bundle `messages/automations`, keyed by `key`.
 */
import type { UserRole } from '@restomatch/db';
import { FEATURE_KEYS, OWNER_TOGGLEABLE, featureEnabled, type FeatureKey, type OwnerToggleableKey } from '../lib/features';

/** Option keys (not flag keys): stored in `restaurants.settings.automations`. */
export const AUTOMATION_OPTION_KEYS = [
  'orderReminders',
  'supplierDelays',
  'eveningDigest',
  'receiverBrief',
  // AU-04 (orchestrator 14.11): NEW sends → default OFF.
  'receiverLateNotice',
  'rematchAlerts',
  'recoveryBookkeeper',
  'chaseAcknowledged',
  // AU-13 (A18) price-creep sections: digest + contract expiry default ON (they replace behaviour on main), list diff OFF.
  'priceCreepDigest',
  'contractExpiry',
  'priceListDiff',
] as const;
export type AutomationOptionKey = (typeof AUTOMATION_OPTION_KEYS)[number];

export type AutomationControl =
  | { kind: 'flag'; flag: FeatureKey }
  | { kind: 'option'; option: AutomationOptionKey; default: boolean }
  | { kind: 'always' };

/** Existing Asia/Jerusalem slots (cron.ts) or an event / view-only surface. */
export type AutomationSlot =
  | '06:00'
  | '07:00'
  | '08:30'
  | '09:00'
  | '10:00'
  | '19:00'
  | '1st 07:45'
  | 'event'
  | 'view';

/**
 * How a row's runs are recognised in `notifications_outbox`. A plain prefix is
 * not enough on today's producers (match alerts have no dedupe key; late trucks
 * share `po:` with the PO "placed" send), so each row names its own matcher.
 * `none` = no reliable matcher yet → the UI says "עוד לא נמדד".
 */
export type OutboxKeyMatch = { kind: 'prefix'; prefix: string } | { kind: 'like'; like: string };
export type OutboxMatch =
  | OutboxKeyMatch
  /** Any of these key matchers: a producer whose key format changed counts its historic rows too. */
  | { kind: 'anyOf'; matchers: ReadonlyArray<OutboxKeyMatch> }
  | { kind: 'relatedEntityType'; type: string }
  | { kind: 'none' };

export interface AutomationDef {
  /** Research-catalogue id (KPI key for AU-07). */
  id: string;
  /** Stable row key (i18n key, URL-safe). */
  key: string;
  control: AutomationControl;
  slot: AutomationSlot;
  audience: ReadonlyArray<UserRole>;
  /** The message / surface shows ₪ amounts. Never true for a receiver-only row. */
  carriesIls: boolean;
  outboxMatch: OutboxMatch;
  /** Inactive (whatever its switch says) until this flag is on — e.g. WhatsApp ingest. */
  requires?: FeatureKey;
}

export const AUTOMATIONS: ReadonlyArray<AutomationDef> = [
  {
    id: 'A3',
    key: 'priceAlerts',
    control: { kind: 'flag', flag: 'priceAlerts' },
    slot: '07:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'price-alert:' },
  },
  {
    id: 'A8',
    key: 'recovery',
    control: { kind: 'flag', flag: 'recovery' },
    slot: '08:30',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'recovery-reminder:' },
  },
  {
    id: 'A9',
    key: 'monthlyReport',
    control: { kind: 'flag', flag: 'monthlyReport' },
    slot: '1st 07:45',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'monthly-report:' },
  },
  {
    id: 'A10',
    key: 'vatAtRisk',
    control: { kind: 'flag', flag: 'vatAtRisk' },
    slot: 'view',
    audience: ['owner', 'bookkeeper'],
    carriesIls: true,
    outboxMatch: { kind: 'none' },
  },
  {
    id: 'A5',
    key: 'orderReminders',
    control: { kind: 'option', option: 'orderReminders', default: true },
    slot: '09:00',
    // The job e-mails the chef too (ORDER_REMINDER_ROLES; the chef orders directly).
    audience: ['owner', 'manager', 'chef'],
    carriesIls: false,
    // AU-04: the job dedupes on `au:A5:<rid>:<userId>:<sid>:<day>`.
    outboxMatch: { kind: 'prefix', prefix: 'au:A5:' },
  },
  {
    id: 'A6',
    key: 'supplierDelays',
    // AU-04: supplierDelays.ts honours the option. Default ON: every tenant already gets
    // the late-truck mail today (continuity). Its day-1 receiver notice is a NEW send on
    // its own switch (A6b receiverLateNotice, default OFF).
    control: { kind: 'option', option: 'supplierDelays', default: true },
    slot: '10:00',
    audience: ['owner', 'manager'],
    carriesIls: false,
    // Historic `po:<id>:late:d<n>:<email>` rows + AU-04's `au:A6:d<n>:…` keys.
    outboxMatch: {
      kind: 'anyOf',
      matchers: [
        { kind: 'like', like: 'po:%:late:%' },
        { kind: 'prefix', prefix: 'au:A6:' },
      ],
    },
  },
  {
    id: 'A7',
    key: 'eveningDigest',
    // AU-04: endOfDayReport.ts honours the option. A7 IS the 19:00 end-of-day digest
    // (one per recipient per Israel day), never a second evening mail. Default ON (today's behaviour).
    control: { kind: 'option', option: 'eveningDigest', default: true },
    slot: '19:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    // Historic + current `eod-report:` rows; `au:A7:` reserved for the digest's notify() keys.
    outboxMatch: {
      kind: 'anyOf',
      matchers: [
        { kind: 'prefix', prefix: 'eod-report:' },
        { kind: 'prefix', prefix: 'au:A7:' },
      ],
    },
  },
  {
    id: 'A4',
    key: 'receiverBrief',
    // AU-04: dailyExpectations.ts sends it (06:00, e-mail per AD3). A NEW send with no
    // owner decision for default-on → OFF for existing tenants; an admin / owner turns it on.
    control: { kind: 'option', option: 'receiverBrief', default: false },
    slot: '06:00',
    audience: ['receiver'],
    carriesIls: false,
    outboxMatch: { kind: 'prefix', prefix: 'au:A4:' },
  },
  {
    id: 'A6b',
    key: 'receiverLateNotice',
    // AU-04: the day-1 "the truck is late" notice to receivers (no ₪, no supplier link),
    // sent by supplierDelays.ts at 10:00. A NEW send → default OFF.
    control: { kind: 'option', option: 'receiverLateNotice', default: false },
    slot: '10:00',
    audience: ['receiver'],
    carriesIls: false,
    outboxMatch: { kind: 'prefix', prefix: 'au:A6:d1:receiver:' },
  },
  {
    id: 'A1',
    key: 'matchAlerts',
    control: { kind: 'always' },
    slot: 'event',
    // The first-match alert goes to the roles the findings route to (rolesNeedingNotification).
    audience: ['owner', 'manager', 'bookkeeper'],
    carriesIls: true,
    outboxMatch: { kind: 'relatedEntityType', type: 'match_run' },
  },
  {
    id: 'A1b',
    key: 'rematchAlerts',
    // AU-04: a RE-match (OCR edit, receiving count, mapping confirm) that finds NEW
    // findings tells their deciders. Main sends nothing on a re-match → a NEW send,
    // no owner decision → default OFF (orchestrator review B1, 14.11).
    control: { kind: 'option', option: 'rematchAlerts', default: false },
    slot: 'event',
    audience: ['owner', 'manager', 'bookkeeper'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'au:A1:' },
  },
  {
    id: 'A8b',
    key: 'recoveryBookkeeper',
    control: { kind: 'option', option: 'recoveryBookkeeper', default: true },
    slot: '08:30',
    audience: ['bookkeeper'],
    carriesIls: true,
    outboxMatch: { kind: 'none' },
  },
  {
    id: 'A8c',
    key: 'chaseAcknowledged',
    control: { kind: 'option', option: 'chaseAcknowledged', default: true },
    slot: '08:30',
    audience: ['owner', 'manager', 'bookkeeper'],
    carriesIls: true,
    outboxMatch: { kind: 'none' },
  },
  {
    id: 'A11',
    key: 'orderCapture',
    control: { kind: 'flag', flag: 'orderCapture' },
    slot: 'event',
    audience: ['owner', 'manager', 'chef'],
    carriesIls: false,
    outboxMatch: { kind: 'none' },
    requires: 'ingestWhatsapp',
  },
  // AU-13 (catalogue A18): sections of the 07:00 price mail. priceCreepDigest + contractExpiry default ON
  // (they replace behaviour already on main), priceListDiff default OFF (orchestrator 7.11).
  {
    id: 'A18',
    key: 'priceCreepDigest',
    control: { kind: 'option', option: 'priceCreepDigest', default: true },
    slot: '07:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'au:A18:' },
  },
  {
    id: 'A18b',
    key: 'contractExpiry',
    control: { kind: 'option', option: 'contractExpiry', default: true },
    slot: '07:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'none' },
  },
  {
    id: 'A18c',
    key: 'priceListDiff',
    control: { kind: 'option', option: 'priceListDiff', default: false },
    slot: '07:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'none' },
  },
];

export function isAutomationOptionKey(key: string): key is AutomationOptionKey {
  return (AUTOMATION_OPTION_KEYS as ReadonlyArray<string>).includes(key);
}

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as ReadonlyArray<string>).includes(key);
}

export function isOwnerToggleable(key: string): key is OwnerToggleableKey {
  return (OWNER_TOGGLEABLE as ReadonlyArray<string>).includes(key);
}

/** The registry default of an option key (FALSE when no row names it: never a silent default-on). */
export function optionDefault(key: AutomationOptionKey): boolean {
  for (const a of AUTOMATIONS) {
    if (a.control.kind === 'option' && a.control.option === key) return a.control.default;
  }
  return false;
}

/** True when the FEATURES_OFF kill-switch turns `flag` off for every tenant. */
export function flagKilled(flag: FeatureKey, env: NodeJS.ProcessEnv = process.env): boolean {
  return !featureEnabled({ features: { [flag]: true } }, flag, env);
}
