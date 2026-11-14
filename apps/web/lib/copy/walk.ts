import { ALL_NAMESPACES } from '../i18n/messages';
import type { MessageTree } from '../i18n/translate';

/**
 * The one catalog walker (W2-16 guard; W2-13's copy-gate imports it too — MECHANISM §6.5.5).
 * Hebrew is the source of truth; i18n.test already guards en parity.
 */
export interface Leaf {
  /** Namespace name, e.g. `overview`. */
  ns: string;
  /** Dotted key path inside the namespace, e.g. `pending.line`. */
  path: string;
  text: string;
}

export function leavesOf(ns: string, tree: MessageTree, prefix = ''): Leaf[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [{ ns, path: `${prefix}${k}`, text: v }] : leavesOf(ns, v, `${prefix}${k}.`),
  );
}

/** Every Hebrew leaf of every registered namespace (messages/index.ts ALL_NAMESPACES). */
export function walkHebrew(namespaces: ReadonlyArray<{ name: string; he: MessageTree }> = ALL_NAMESPACES as never): Leaf[] {
  return namespaces.flatMap((n) => leavesOf(n.name, n.he));
}

export const leafId = (l: Pick<Leaf, 'ns' | 'path'>): `${string}:${string}` => `${l.ns}:${l.path}`;
