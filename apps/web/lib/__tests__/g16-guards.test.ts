/**
 * G-16 guards: every rule catches a planted violation and leaves the safe shape
 * alone (hard assertions), then the real tree is scanned in WARN mode — the
 * per-area counts are printed, and only G16_MODE=error (W4-01) fails on them.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { areaOf, checkSource, formatSummary, guardMode, scanTree, summarize } from '../../scripts/guards/engine';
import {
  RULES,
  clientApiValueImport,
  moneySwallow,
  onchangeMutation,
  receiverIdbDelete,
  statusLiterals,
} from '../../scripts/guards/rules';

const DASH = 'apps/web/app/dashboard/orders/x.tsx';
const ids = (f: { rule: string }[]) => f.map((x) => x.rule);

describe('onchange-mutation', () => {
  it('flags a select whose onChange calls a tRPC mutation', () => {
    const src = `'use client';
      export function P({ m }) { return <select onChange={(e) => m.mutate({ v: e.target.value })} />; }`;
    expect(ids(checkSource(DASH, src, [onchangeMutation]))).toEqual(['onchange-mutation']);
  });
  it('follows a named handler one level and catches startTransition / run / fetch', () => {
    const src = `'use client';
      function save(v) { startTransition(() => {}); }
      const onPick = (e) => save(e.target.value);
      export function P() { return <><input type="radio" onChange={onPick} /><input type="checkbox" onChange={() => fetch('/x')} /><Select onValueChange={() => run(1)} /></>; }`;
    expect(ids(checkSource(DASH, src, [onchangeMutation]))).toHaveLength(3);
  });
  it('catches an imported server action (by a use-server module)', () => {
    const src = `'use client';
      import { setRole } from './role';
      export function P() { return <select onChange={(e) => setRole(e.target.value)} />; }`;
    const found = checkSource(DASH, src, [onchangeMutation], { './role': `'use server';\nexport async function setRole() {}` });
    expect(found[0]?.message).toMatch(/server action/);
  });
  it('leaves local state, text inputs and the settings-toggle allow-list alone', () => {
    const src = `'use client';
      export function P({ m }) { return <><select onChange={(e) => setV(e.target.value)} /><input onChange={() => m.mutate()} /></>; }`;
    expect(checkSource(DASH, src, [onchangeMutation])).toEqual([]);
    const toggle = `'use client'; export function T({ m }) { return <input type="checkbox" onChange={() => m.mutate()} />; }`;
    expect(checkSource('apps/web/app/dashboard/settings/a.tsx', toggle, [onchangeMutation])).toEqual([]);
    expect(checkSource(DASH, toggle, [onchangeMutation])).toHaveLength(1);
  });
});

describe('money-swallow', () => {
  it('flags .catch(() => null | [] | undefined) on a money read', () => {
    const src = `export default async function P({ caller }) {
      const a = await caller.owner.leakHero().catch(() => null);
      const b = await caller.recovery.list().catch(() => []);
      const c = await caller.payRun.preview().catch(() => undefined);
      return null; }`;
    expect(ids(checkSource('apps/web/app/dashboard/leaks/page.tsx', src, [moneySwallow]))).toHaveLength(3);
  });
  it('flags `?? 0` on *Ils / *Agorot only in a server component', () => {
    const src = `export default function P({ r }) { return <b>{r.leakIls ?? 0}{r.amountAgorot ?? 0}{r.count ?? 0}</b>; }`;
    expect(checkSource('apps/web/app/dashboard/leaks/page.tsx', src, [moneySwallow])).toHaveLength(2);
    expect(checkSource('apps/web/app/dashboard/leaks/page.tsx', `'use client';\n${src}`, [moneySwallow])).toEqual([]);
  });
  it('leaves non-money reads and a logged fallback alone ("utils" is not "Ils")', () => {
    const src = `async function f(utils, caller) {
      await utils.orders.get.fetch({ poId: 1 }).catch(() => null);
      await caller.owner.leakHero().catch((e) => { log(e); return null; });
      await caller.team.list().catch(() => []); }`;
    expect(checkSource('apps/web/app/dashboard/x.tsx', src, [moneySwallow])).toEqual([]);
  });
});

describe('receiver-idb-delete', () => {
  const idb = `const db = indexedDB.open('q');`;
  it('flags store deletes / clears / deleteDatabase outside outbox.ts', () => {
    const src = `${idb}
      function rm(s, id) { s.delete(id); store.clear(); indexedDB.deleteDatabase('q'); }`;
    expect(checkSource('apps/web/lib/pwa/queue.ts', src, [receiverIdbDelete])).toHaveLength(3);
    expect(checkSource('apps/web/lib/pwa/outbox.ts', src, [receiverIdbDelete])).toEqual([]);
  });
  it('ignores Map/Set deletes and files that never touch IndexedDB', () => {
    expect(checkSource('apps/web/lib/pwa/queue.ts', `${idb}\nconst seen = new Map(); seen.delete(1); cache.delete(2);`, [receiverIdbDelete])).toEqual([]);
    expect(checkSource('apps/web/lib/pwa/queue.ts', `s.delete(1);`, [receiverIdbDelete])).toEqual([]);
  });
});

describe('status-literals', () => {
  it('flags an inline status list outside the lifecycle modules', () => {
    const src = `const q = where(inArray(t.status, ['sent', 'confirmed', 'partial']));`;
    expect(ids(checkSource('packages/api/src/routers/orders.ts', src, [statusLiterals]))).toEqual(['status-literals']);
  });
  it('allows the lifecycle modules, exported *_STATUSES definitions and non-status lists', () => {
    const src = `const q = ['sent', 'confirmed'];`;
    expect(checkSource('packages/api/src/recovery/lifecycle.ts', src, [statusLiterals])).toEqual([]);
    expect(checkSource('packages/api/src/lib/deliveryState.ts', src, [statusLiterals])).toEqual([]);
    expect(checkSource('packages/api/src/lib/claims.ts', `export const CLAIMABLE_STATUSES = ['open', 'escalated', 'accepted'] as const;`, [statusLiterals])).toEqual([]);
    expect(checkSource('packages/api/src/routers/x.ts', `const l = ['he', 'en']; const one = ['open'];`, [statusLiterals])).toEqual([]);
  });
});

describe('client-api-value-import', () => {
  it("flags value imports of @restomatch/api in a 'use client' file", () => {
    const src = `'use client';\nimport { claimableLines, type X } from '@restomatch/api';\nimport * as api from '@restomatch/api/x';`;
    expect(checkSource('apps/web/app/dashboard/x.tsx', src, [clientApiValueImport])).toHaveLength(2);
  });
  it('allows type-only imports and server files', () => {
    expect(checkSource('apps/web/app/dashboard/x.tsx', `'use client';\nimport type { AppRouter } from '@restomatch/api';\nimport { type Y } from '@restomatch/api';`, [clientApiValueImport])).toEqual([]);
    expect(checkSource('apps/web/app/dashboard/x.tsx', `import { claimableLines } from '@restomatch/api';`, [clientApiValueImport])).toEqual([]);
  });
});

describe('engine', () => {
  it('derives per-area keys', () => {
    expect(areaOf('apps/web/app/dashboard/leaks/claims/page.tsx')).toBe('web:dashboard/leaks');
    expect(areaOf('apps/web/app/(marketing)/leak-check/page.tsx')).toBe('web:leak-check');
    expect(areaOf('apps/web/lib/pwa/offlineQueue.ts')).toBe('web:lib/pwa');
    expect(areaOf('packages/api/src/routers/payRun.ts')).toBe('api:payRun');
    expect(areaOf('packages/api/src/recovery/service.ts')).toBe('api:recovery');
  });
  it('starts in warn; --strict or G16_MODE=error flips it', () => {
    expect(guardMode({}, [])).toBe('warn');
    expect(guardMode({ G16_MODE: 'error' }, [])).toBe('error');
    expect(guardMode({}, ['--strict'])).toBe('error');
  });
});

describe('the real tree (warn mode, per-area counts)', () => {
  it('scans apps/web + packages/api and reports every rule', () => {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const findings = scanTree(repoRoot, RULES);
    const summary = summarize(findings, RULES);
    const mode = guardMode();
    console.warn(formatSummary(summary, mode));
    expect(Object.keys(summary.byRule)).toEqual(RULES.map((r) => r.id));
    if (mode === 'error') expect(findings.map((f) => `${f.path}:${f.line} ${f.rule}`)).toEqual([]);
  });
});
