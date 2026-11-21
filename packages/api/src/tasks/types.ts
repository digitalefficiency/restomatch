import type { UserRole } from '@restomatch/db';

/**
 * The task spine (W2-08): one computed, per-viewer list of "what is waiting on
 * me". It feeds the home "מחכה לך", the nav badges and the bell, so the same
 * queue shows the same ₪ everywhere. Computed per request; no table (H-04).
 */
export const TASK_TYPES = [
  'order_due',
  'supplier_change',
  'delivery_due',
  'delivery_late',
  'receipt_exception',
  'doc_review',
  'decision',
  'waiting_on_others',
  'consolidated_link',
  'claim_to_send',
  'supplier_disputed',
  'credit_to_match',
  'allocation_missing',
  'payment_due',
  'close_step',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** T1 the leak hero · T2 act now · T3 good news · T4 pending / neutral. */
export type Tier = 'T1' | 'T2' | 'T3' | 'T4';
/** The row's badge colour. Danger only when something blocks a payment. */
export type TaskTone = 'danger' | 'warn' | 'neutral';

export interface Task {
  type: TaskType;
  /** Stable id: the entity (invoice, claim, PO) or the queue (`decision:mine`). */
  entityId: string;
  /** i18n key under `overview.tasks.<title>` (the web translates; the server is locale-free). */
  title: string;
  /** ₪ in integer agorot. `null` = a count-only item, or a viewer without `money.view`. */
  ilsAgorot: number | null;
  /** How many items this row stands for. */
  count: number;
  /** Items that block a payment (danger). */
  blocking: number;
  tier: Tier;
  tone: TaskTone;
  /** Israel calendar day the item is due (`YYYY-MM-DD`), when it has one. */
  due: string | null;
  /** Whole days since the oldest item arrived. */
  ageDays: number | null;
  /** i18n key under `overview.tasks.verb.<verb>`: the one verb that names the tap. */
  verb: string;
  /** The exact card (`?inv=`, `#id`), never the home. */
  deepLink: string;
  /** `mine` = mine to do; `others` = waiting on someone else (count, ₪, with whom). */
  scope: 'mine' | 'others';
  /** For `others`: whose queue it waits in. */
  withRole?: UserRole | null;
  /** Type-specific numbers the row's second line names (counts, side ₪ in agorot). */
  detail?: Record<string, number | string | null>;
}

export interface TasksResult {
  tasks: Task[];
  /** Is anything waiting anywhere in the restaurant? "הכל טופל" (T3) only when false. */
  restaurantClear: boolean;
  /** Sources that could not be read: the home shows an error, never "הכל טופל". */
  failed: string[];
}
