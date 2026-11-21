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
export type OutboxMatch =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'like'; like: string }
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
    // Train C (C3): supplierDelays.ts does not read the option yet, so no switch is
    // offered ("תמיד פעיל"). Flip back to the option once the job honours it.
    control: { kind: 'always' },
    slot: '10:00',
    audience: ['owner', 'manager'],
    carriesIls: false,
    outboxMatch: { kind: 'like', like: 'po:%:late:%' },
  },
  {
    id: 'A7',
    key: 'eveningDigest',
    // Train C (C3): endOfDayReport.ts does not read the option yet — "תמיד פעיל", no switch.
    control: { kind: 'always' },
    slot: '19:00',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'prefix', prefix: 'eod-report:' },
  },
  // Train C (C3): receiverBrief (A4) is hidden until a job sends receiverMorningBrief;
  // its option key stays in AUTOMATION_OPTION_KEYS so briefs/options.ts keeps resolving.

  {
    id: 'A1',
    key: 'matchAlerts',
    control: { kind: 'always' },
    slot: 'event',
    audience: ['owner', 'manager'],
    carriesIls: true,
    outboxMatch: { kind: 'relatedEntityType', type: 'match_run' },
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

/** The registry default of an option key (true when no row names it). */
export function optionDefault(key: AutomationOptionKey): boolean {
  for (const a of AUTOMATIONS) {
    if (a.control.kind === 'option' && a.control.option === key) return a.control.default;
  }
  return true;
}

/** True when the FEATURES_OFF kill-switch turns `flag` off for every tenant. */
export function flagKilled(flag: FeatureKey, env: NodeJS.ProcessEnv = process.env): boolean {
  return !featureEnabled({ features: { [flag]: true } }, flag, env);
}
