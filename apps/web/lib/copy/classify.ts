import type { Leaf } from './walk';

/** Copy classes and their caps (MECHANISM §5.3). */
export type CopyClass = 'exempt' | 'explain' | 'button' | 'toast' | 'confirm' | 'a11y' | 'visible';

export const CAPS: Record<CopyClass, { words: number; sentenceWords?: number; sentences?: number } | null> = {
  exempt: null,
  a11y: null,
  explain: { words: 40, sentenceWords: 12 },
  button: { words: 4 },
  toast: { words: 8 },
  confirm: { words: 30 },
  visible: { words: 12, sentences: 1 },
};

const EXEMPT_NS = new Set(['marketing', 'landing', 'showcase', 'growth', 'leakCheck', 'emails']);
const LEGAL_SEG = new Set(['legal', 'privacy', 'terms', 'cookies', 'accessibility']);

export function classify(leaf: Pick<Leaf, 'ns' | 'path'>): CopyClass {
  const segs = leaf.path.split('.');
  const last = segs[segs.length - 1]!;
  if (EXEMPT_NS.has(leaf.ns) || segs.some((s) => LEGAL_SEG.has(s))) return 'exempt';
  if (leaf.ns === 'explain' && segs[0] === 'toggle') return 'button';
  if (segs.some((s) => s === 'aria' || s === 'sr') || /(Aria|AriaLabel|Sr)$/.test(last) || last === 'ariaLabel') return 'a11y';
  if (leaf.ns === 'explain' || segs.includes('explain')) return 'explain';
  if (segs.some((s) => /toast/i.test(s))) return 'toast';
  if (segs.some((s) => s.startsWith('confirm')) && /^(title|body|message)$|(Body|Title)$/.test(last)) return 'confirm';
  if (segs.includes('actions') || /^(cta|button)$|(Cta|Button)$/.test(last)) return 'button';
  return 'visible';
}

/** Namespace → the wave-2 package that adopts its rows (MECHANISM §6.4); used by the allowlist. */
export const ADOPTER: Record<string, string> = {
  overview: 'W2-08', nav: 'W2-08',
  approvals: 'W2-04',
  payRun: 'W2-03',
  invoices: 'W2-02', scans: 'W2-02', ingest: 'W2-02',
  receiving: 'W2-05', receivingDelivery: 'W2-05', dockPrice: 'W2-05', receiverLangs: 'W2-05',
  orders: 'W2-06',
  inventory: 'W2-07',
  leaks: 'W2-09', leakProof: 'W2-09', views: 'W2-09',
  recovery: 'W2-10',
  suppliers: 'W2-11',
  contracts: 'W2-12',
  settings: 'W2-14', team: 'W2-14', integrations: 'W2-14', accounting: 'W2-14',
  supplierConfirm: 'G-10',
  ask: 'G-12',
  common: 'W2-13', components: 'W2-13',
  explain: 'W2-16',
};
export const adopterOf = (ns: string): string => ADOPTER[ns] ?? 'W2-16b';
