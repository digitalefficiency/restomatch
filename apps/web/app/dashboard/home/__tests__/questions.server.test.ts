import { PassThrough } from 'node:stream';
import * as React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';

// Server i18n reads the locale cookie; render in Hebrew without a request.
vi.mock('@/lib/i18n/server', () => ({
  getT: async (ns: Parameters<typeof createTranslator>[1]) => createTranslator('he', ns),
}));

(globalThis as unknown as { React?: unknown }).React = React;
const { HomeQuestions } = await import('../questions');

/**
 * G-08 · the compensating proof for nav-registry.test.ts's named exception
 * `{ role: 'chef', route: 'catalogMapping', via: 'home question line' }`: the
 * chef's home links to /dashboard/catalog/mapping when questions are open, and
 * shows nothing when there are none. Count only, never ₪.
 */
async function render(node: React.ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = '';
    const sink = new PassThrough();
    sink.on('data', (c) => (html += c.toString()));
    sink.on('end', () => resolve(html));
    const { pipe } = renderToPipeableStream(node, {
      onAllReady: () => pipe(sink),
      onError: reject,
    });
  });
}

const callerWith = (count: number | Error) => ({
  mapping: {
    questionCount: vi.fn(async () => {
      if (count instanceof Error) throw count;
      return { count };
    }),
  },
});

const element = (caller: ReturnType<typeof callerWith>, role: 'chef' | 'owner' | 'manager' | 'receiver' | 'bookkeeper') =>
  (React.createElement as (...a: unknown[]) => React.ReactElement)(HomeQuestions, { caller, role, locale: 'he' });

describe('G-08 home question line', () => {
  it('chef: questionCount > 0 → one link to /dashboard/catalog/mapping, no ₪', async () => {
    const caller = callerWith(3);
    const html = await render(element(caller, 'chef'));
    expect(html).toContain('href="/dashboard/catalog/mapping"');
    expect(html).toContain('data-testid="home-link-questions"');
    expect(html).toContain('זה אותו מוצר?');
    expect(html).not.toContain('₪');
    expect(caller.mapping.questionCount).toHaveBeenCalledTimes(1);
  });

  it('chef: questionCount = 0 → no link', async () => {
    const html = await render(element(callerWith(0), 'chef'));
    expect(html).not.toContain('/dashboard/catalog/mapping');
  });

  it('a failed count hides the line instead of breaking the home', async () => {
    const html = await render(element(callerWith(new Error('db down')), 'chef'));
    expect(html).not.toContain('/dashboard/catalog/mapping');
  });

  it('owner and manager get the same line; receiver and bookkeeper never ask', async () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(await render(element(callerWith(2), role))).toContain('href="/dashboard/catalog/mapping"');
    }
    for (const role of ['receiver', 'bookkeeper'] as const) {
      const caller = callerWith(2);
      expect(await render(element(caller, role))).not.toContain('/dashboard/catalog/mapping');
      expect(caller.mapping.questionCount).not.toHaveBeenCalled();
    }
  });
});
