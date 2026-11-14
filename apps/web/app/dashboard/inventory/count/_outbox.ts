/**
 * The count's line edits as an outbox kind (W2-07 · deep-fix class 2).
 *
 * TARGET: W2-05's IndexedDB outbox core (`apps/web/lib/pwa/outbox.ts`,
 * `registerOutboxKind('inventoryLines', inventoryLinesKind)`). That core is not on
 * this branch's base yet, so this file holds the kind DEFINITION in the core's
 * shape (`send` / `idempotencyKey` / `group`) plus a small interim queue on
 * localStorage with the same guarantees the screen needs today:
 *  - nothing lost on reload / no signal (every edit is on the device before it is sent);
 *  - exactly-once effect (a line edit is idempotent: "set qty of P on count C to Q",
 *    keyed by count + product; a replay of the same key is a no-op on the server);
 *  - attribution (decision 22): each edit carries who typed it; a colleague's
 *    queued edits upload as "נספר על ידי <name>";
 *  - retry on `online`, on visibilitychange → visible, and on a 2/4/8…60 s backoff.
 * TODO(W2-05): register this kind on the core and drop `interimQueue` once #189 is on the base.
 */
import { mergeRetry, type LineEdit } from '../inventory-ui';

export const KIND = 'inventoryLines' as const;
export const BACKOFF_MAX_MS = 60_000;

export interface Attribution {
  userId: string;
  name: string | null;
}

/** One queued line edit: the payload the kind sends. */
export interface InventoryLinePayload {
  countId: string;
  productId: string;
  edit: LineEdit;
  by: Attribution | null;
  at: number;
}

/** The kind, in W2-05's `OutboxKindDef` shape. */
export const inventoryLinesKind = {
  /** Stable identity: the same line on the same count is ONE item (a newer edit replaces it). */
  idempotencyKey: (p: InventoryLinePayload) => `${p.countId}:${p.productId}`,
  /** One count's lines go in order. */
  group: (p: InventoryLinePayload) => `inventory:${p.countId}`,
};

/** 2 s, 4 s, 8 s … capped at 60 s. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, 2000 * 2 ** Math.max(0, attempts - 1));
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const legacyKey = (countId: string) => `rm.inventory.pending.${countId}`;
const queueKey = (countId: string) => `rm.inventory.outbox.${countId}`;

/**
 * The interim on-device queue for one count. Items are keyed by
 * `inventoryLinesKind.idempotencyKey`; a newer edit of the same line merges over
 * the older one field by field (`mergeRetry`'s rule).
 */
export function interimQueue(countId: string, storage: KV | null) {
  const read = (): Record<string, InventoryLinePayload> => {
    try {
      const v = storage?.getItem(queueKey(countId));
      const parsed: unknown = v ? JSON.parse(v) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, InventoryLinePayload>) : {};
    } catch {
      return {};
    }
  };
  const write = (items: Record<string, InventoryLinePayload>) => {
    try {
      if (Object.keys(items).length === 0) storage?.removeItem(queueKey(countId));
      else storage?.setItem(queueKey(countId), JSON.stringify(items));
    } catch {
      // storage full / denied: the in-memory queue still holds the edits
    }
  };
  return {
    read,
    /** Put (or merge) edits for these lines. */
    put(edits: Record<string, LineEdit>, by: Attribution | null, now = Date.now()) {
      const items = read();
      for (const [productId, edit] of Object.entries(edits)) {
        const p: InventoryLinePayload = { countId, productId, edit, by, at: now };
        const k = inventoryLinesKind.idempotencyKey(p);
        const old = items[k];
        items[k] = old ? { ...p, edit: { ...old.edit, ...edit } } : p;
      }
      write(items);
    },
    /** Drop exactly what was sent (a newer edit typed meanwhile stays queued). */
    ack(sent: Record<string, LineEdit>) {
      const items = read();
      for (const [productId, edit] of Object.entries(sent)) {
        const k = `${countId}:${productId}`;
        const cur = items[k];
        if (cur && JSON.stringify(cur.edit) === JSON.stringify(edit)) delete items[k];
      }
      write(items);
    },
    clear() {
      write({});
    },
    replace(items: Record<string, InventoryLinePayload>) {
      write(items);
    },
    edits(): Record<string, LineEdit> {
      return Object.fromEntries(Object.values(read()).map((p) => [p.productId, p.edit] as const));
    },
    /** The names of OTHER people whose edits are queued here (decision 22). */
    othersBy(userId: string | null): string[] {
      const names = new Set<string>();
      for (const p of Object.values(read())) if (p.by && p.by.userId !== userId && p.by.name) names.add(p.by.name);
      return [...names];
    },
    size: () => Object.keys(read()).length,
  };
}

/**
 * Zero-loss migration of the old `pendingStore` rows (`rm.inventory.pending.<countId>`)
 * onto the queue: merged UNDER anything already queued, then the old key is removed.
 * Idempotent (a second run finds nothing to move).
 */
/** `by`: who the legacy rows are attributed to (they carried none; null = unknown). */
export function migrateLegacyPending(countId: string, storage: KV | null, by: Attribution | null = null): number {
  let legacy: Record<string, LineEdit> = {};
  try {
    const v = storage?.getItem(legacyKey(countId));
    const parsed: unknown = v ? JSON.parse(v) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) legacy = parsed as Record<string, LineEdit>;
  } catch {
    return 0;
  }
  const n = Object.keys(legacy).length;
  if (n === 0) return 0;
  const q = interimQueue(countId, storage);
  const queued = q.read();
  const now = Date.now();
  for (const [productId, edit] of Object.entries(legacy)) {
    const k = `${countId}:${productId}`;
    const cur = queued[k];
    // Older legacy edits go UNDER anything already queued (field by field), keeping the queued attribution.
    queued[k] = cur ? { ...cur, edit: mergeRetry({ [productId]: edit }, { [productId]: cur.edit })[productId]! } : { countId, productId, edit, by, at: now };
  }
  q.replace(queued);
  try {
    storage?.removeItem(legacyKey(countId));
  } catch {
    // keep going: the queue already holds every edit
  }
  return n;
}
