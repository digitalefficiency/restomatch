import { PassThrough } from 'node:stream';
import * as React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { overview } from '@/lib/i18n/messages/overview';
import { homeCaller, type Caller } from '../caller';

// The web vitest config compiles .tsx with the classic JSX runtime (React in scope);
// Next uses the automatic one. Provide the global before loading the components.
(globalThis as unknown as { React?: unknown }).React = React;
const { ChefHome, ReceiverHome } = await import('../staff');

/**
 * Staff homes, server side (W1-05 scope fix 3): render the receiver and chef
 * "Today" homes as the server does (async components, Suspense) on top of a
 * RECORDING caller, then check two things a browser can't see:
 *   1. the procedures the server actually called — no owner.* money, no
 *      approvals / recovery / payRun, and no activity.feed;
 *   2. the HTML it streamed — no ₪ anywhere, no activity feed mounted.
 * The fixtures carry money on purpose (cost per plate, unit prices): if a staff
 * component ever rendered it, the DOM check fails.
 */

const ROW = {
  poId: '11111111-1111-4111-8111-111111111111',
  supplierId: '22222222-2222-4222-8222-222222222222',
  supplierName: 'ירקות השרון',
  supplierNameEn: null,
  expectedAt: new Date(Date.now() + 3_600_000).toISOString(),
  hasDeliveryDate: true,
  lineCount: 6,
  status: 'sent',
  receiptId: null,
  receiptStatus: null,
  late: false,
  closedAt: null,
};

const FIXTURES: Record<string, unknown> = {
  'receiving.todayExpectations': [ROW, { ...ROW, poId: '33333333-3333-4333-8333-333333333333', receiptStatus: 'completed', receiptId: 'g', closedAt: new Date().toISOString() }],
  'inventory.enabled': { enabled: true },
  'inventory.current': { status: 'draft', progress: { counted: 12, lines: 40, notCounted: 28 } },
  'recipes.enabled': { enabled: true },
  'recipes.priceAlerts': {
    enabled: true,
    targetBp: 3000,
    alerts: [
      {
        recipeId: '44444444-4444-4444-8444-444444444444',
        name: 'שקשוקה',
        nameEn: 'Shakshuka',
        beforeFoodCostBp: 2900,
        afterFoodCostBp: 3400,
        costDeltaAgorot: 125,
        product: { name: 'עגבניה', nameEn: 'Tomato', unit: 'ק״ג', priceBefore: '6.00', priceNow: '8.50', priceDeltaAgorot: 250, priceChangeBp: 4167 },
        supplier: { id: '22222222-2222-4222-8222-222222222222', name: 'ירקות השרון', nameEn: null },
      },
    ],
  },
};

/** Every namespace and procedure exists; each call is recorded and answered from FIXTURES (unknown → throws). */
function recordingCaller(calls: string[]): Caller {
  const ns = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, proc) =>
          typeof proc === 'string'
            ? async () => {
                const path = `${name}.${proc}`;
                calls.push(path);
                if (!(path in FIXTURES)) throw new Error(`unexpected procedure ${path}`);
                return FIXTURES[path];
              }
            : undefined,
      },
    );
  return new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' && prop !== 'then' ? ns(prop) : undefined) }) as unknown as Caller;
}

function render(node: React.ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const { pipe } = renderToPipeableStream(node, {
      onAllReady() {
        const out = new PassThrough();
        let html = '';
        out.on('data', (c) => (html += c));
        out.on('end', () => resolve(html));
        pipe(out);
      },
      onShellError: reject,
    });
  });
}

const FORBIDDEN_NAMESPACES = ['owner.', 'approvals.', 'recovery.', 'payRun.', 'activity.'];

describe.each(['he', 'en'] as const)('staff homes, rendered on the server (%s)', (locale) => {
  const t = createTranslator(locale, overview);

  it('receiver: calls only receiving.todayExpectations; streams no ₪ and no activity feed', async () => {
    const calls: string[] = [];
    const html = await render(
      React.createElement(ReceiverHome, { caller: homeCaller(recordingCaller(calls), 'receiver'), t, locale, fail: new Set<string>() }),
    );
    expect(calls).toEqual(['receiving.todayExpectations']);
    expect(html).toContain('data-testid="board-next"');
    expect(html).not.toContain('₪');
    expect(html).not.toMatch(/activity/i);
  });

  it('chef: calls only inventory + recipes; streams food-cost % but no ₪ and no activity feed', async () => {
    const calls: string[] = [];
    const html = await render(
      React.createElement(ChefHome, { caller: homeCaller(recordingCaller(calls), 'chef'), t, locale, fail: new Set<string>() }),
    );
    expect([...calls].sort()).toEqual(['inventory.current', 'inventory.enabled', 'recipes.enabled', 'recipes.priceAlerts']);
    for (const c of calls) for (const ns of FORBIDDEN_NAMESPACES) expect(c.startsWith(ns)).toBe(false);
    expect(html).toContain('data-testid="chef-dish"');
    expect(html).toMatch(/%/);
    expect(html).not.toContain('₪');
    expect(html).not.toMatch(/activity/i);
  });
});
