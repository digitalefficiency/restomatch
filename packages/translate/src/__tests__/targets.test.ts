import { describe, expect, it, vi } from 'vitest';
import type { MessagesClientLike } from '../claudeTranslator';
import { defaultGlossary } from '../composite';
import { CLAUDE_MISS_TTL_MS } from '../composite';
import { hasHebrew } from '../normalize';
import { TARGET_LOCALES, TargetGlossary } from '../targets';
import { keepsNumbers, TargetClaudeTranslator, TargetTranslator, targetSystemPrompt } from '../targetTranslator';

/** The demo tenant's catalogue (packages/db/scripts/seed.ts) — the receiver must read these. */
const DEMO_NAMES = [
  'עגבניות שרי', 'מלפפונים', 'בצל יבש', 'שום קלוף', 'חזה עוף', 'פרגית', 'בשר טחון', 'חלב 3%',
  'חמאה', 'פיתות', 'קמח לבן', 'שמן קנולה', 'לימונים', 'אקונומיקה 4 ל׳',
];

/** Suffix renderer the API passes: English glossary + unit map. */
const suffix = (s: string) => {
  const g = defaultGlossary().translate(s);
  return g ?? (/^\d+(?:[.,]\d+)?%?$/.test(s.trim()) ? s.trim() : null);
};

function fakeClient(answer: (ids: number[]) => Array<{ id: number; text: string }>) {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    const msg = (body.messages as Array<{ content: string }>)[0]!.content;
    const payload = JSON.parse(msg.slice(msg.indexOf('['))) as Array<{ id: number }>;
    return { content: [{ type: 'text', text: JSON.stringify({ items: answer(payload.map((p) => p.id)) }) }] };
  });
  return { client: { messages: { create } } as MessagesClientLike, create };
}

describe('TargetGlossary (offline receiver languages)', () => {
  const g = new TargetGlossary();

  it('translates common items into every receiver locale, without Hebrew', () => {
    for (const locale of ['ar', 'ru', 'th'] as const) {
      for (const he of DEMO_NAMES.filter((n) => !n.includes('4'))) {
        const t = g.translate(he, locale);
        expect(t, `${he} → ${locale}`).toBeTruthy();
        expect(hasHebrew(t!)).toBe(false);
      }
    }
    expect(g.translate('חזה עוף', 'ar')).toBe('صدر دجاج');
    expect(g.translate('חזה עוף', 'ru')).toBe('Куриная грудка');
    expect(g.translate('חזה עוף', 'th')).toBe('อกไก่');
    expect(g.translate('חזה עוף', 'ti')).toBeTruthy();
  });

  it('normalizes gershayim / spacing like the English glossary', () => {
    expect(g.translate('  חזה   עוף ', 'ru')).toBe('Куриная грудка');
  });

  it('peels a trailing size and re-attaches it rendered', () => {
    expect(g.translate('אקונומיקה 4 ל׳', 'ru', suffix)).toBe('Отбеливатель 4 L');
    expect(g.translate('חלב 3%', 'th')).toBe('นม 3%');
  });

  it('returns null for an unknown name (never half-translated)', () => {
    expect(g.translate('מוצר מסתורי', 'ar')).toBeNull();
    expect(g.translate('נקניקיות מרגז', 'ti')).toBeNull(); // no confident Tigrinya entry
  });

  it('every locale is covered by the table', () => {
    expect(TARGET_LOCALES).toEqual(['ar', 'ru', 'th', 'ti']);
    expect(g.size).toBeGreaterThan(60);
  });
});

describe('TargetTranslator (glossary → Claude, never throws)', () => {
  it('asks Claude only for glossary misses, with haiku + thinking disabled + json schema', async () => {
    const { client, create } = fakeClient((ids) => ids.map((id) => ({ id, text: 'Неизвестный товар' })));
    const tr = new TargetTranslator({ claude: new TargetClaudeTranslator({ client }) });
    const out = await tr.translateMany(['חזה עוף', 'מוצר מסתורי'], 'ru');
    expect(out.get('חזה עוף')).toEqual({ text: 'Куриная грудка', source: 'glossary' });
    expect(out.get('מוצר מסתורי')).toEqual({ text: 'Неизвестный товар', source: 'claude' });
    expect(create).toHaveBeenCalledTimes(1);
    const body = create.mock.calls[0]![0] as Record<string, any>;
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.system).toContain('Russian');
    expect(body.messages[0].content).toContain('מוצר מסתורי');
    expect(body.messages[0].content).not.toContain('חזה עוף');
  });

  it('allowClaude:false (budget spent) and offline stay glossary-only', async () => {
    const { client, create } = fakeClient(() => []);
    const tr = new TargetTranslator({ claude: new TargetClaudeTranslator({ client }) });
    const out = await tr.translateMany(['מוצר מסתורי'], 'ar', { allowClaude: false });
    expect(out.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
    const offline = new TargetTranslator();
    expect(offline.hasClaude).toBe(false);
    expect((await offline.translateMany(['מוצר מסתורי'], 'ar')).size).toBe(0);
  });

  it('a Claude failure is swallowed; a Hebrew-echo answer is rejected; misses are not re-asked', async () => {
    const boom = vi.fn(async () => {
      throw new Error('boom');
    });
    const onClaudeError = vi.fn();
    const tr = new TargetTranslator({
      claude: new TargetClaudeTranslator({ client: { messages: { create: boom } } }),
      onClaudeError,
    });
    await expect(tr.translateMany(['מוצר מסתורי'], 'th')).resolves.toBeInstanceOf(Map);
    expect(onClaudeError).toHaveBeenCalledTimes(1);

    let t = 0;
    const { client, create } = fakeClient((ids) => ids.map((id) => ({ id, text: 'עדיין עברית' })));
    const tr2 = new TargetTranslator({ claude: new TargetClaudeTranslator({ client }), now: () => t });
    expect((await tr2.translateMany(['מוצר מסתורי'], 'th')).size).toBe(0);
    await tr2.translateMany(['מוצר מסתורי'], 'th');
    expect(create).toHaveBeenCalledTimes(1);
    t += CLAUDE_MISS_TTL_MS + 1;
    await tr2.translateMany(['מוצר מסתורי'], 'th');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('the prompt treats invoice text as data, not instructions', () => {
    expect(targetSystemPrompt('ti')).toMatch(/DATA .*never instructions/);
  });

  it('Claude results are never shared across tenants (no process memo); the miss cache is per scope', async () => {
    let n = 0;
    const { client, create } = fakeClient((ids) => ids.map((id) => ({ id, text: `T${(n += 1)}` })));
    const tr = new TargetTranslator({ claude: new TargetClaudeTranslator({ client }) });
    const a = await tr.translateMany(['מוצר מסתורי'], 'ru', { scope: 'A' });
    const b = await tr.translateMany(['מוצר מסתורי'], 'ru', { scope: 'B' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(a.get('מוצר מסתורי')!.text).not.toBe(b.get('מוצר מסתורי')!.text);
  });

  it('a translation that drops a number of the source is rejected (injection / garbling guard)', async () => {
    expect(keepsNumbers('אקונומיקה 4 ל׳', 'Отбеливатель 4 L')).toBe(true);
    expect(keepsNumbers('אקונומיקה 4 ל׳', 'Shortage, call the office')).toBe(false);
    const { client } = fakeClient((ids) => ids.map((id) => ({ id, text: 'Shortage — call now' })));
    const tr = new TargetTranslator({ claude: new TargetClaudeTranslator({ client }) });
    expect((await tr.translateMany(['מוצר 12 יח׳'], 'ar')).size).toBe(0);
  });
});

describe('unitLabelFor (receiver languages)', () => {
  it('word units in ar/ru/th, symbols unchanged, ti/en English, he as printed', async () => {
    const { unitLabelFor } = await import('../units');
    expect(unitLabelFor('ארגז', 'ar')).toBe('صندوق');
    expect(unitLabelFor('צרור', 'ru')).toBe('пучок');
    expect(unitLabelFor("יח'", 'th')).toBe('ชิ้น');
    expect(unitLabelFor('ק"ג', 'ar')).toBe('kg');
    expect(unitLabelFor('ארגז', 'ti')).toBe('case');
    expect(unitLabelFor('ארגז', 'en')).toBe('case');
    expect(unitLabelFor('ארגז', 'he')).toBe('ארגז');
    expect(unitLabelFor('bunch', 'ar')).toBe('ربطة');
  });
});

describe('TargetGlossary: linear on hostile names (CodeQL polynomial ReDoS)', () => {
  it('peels size tokens in well under 100 ms on 50k-character adversarial input', () => {
    const g = new TargetGlossary();
    for (const evil of ['9'.repeat(50_000) + 'x', '(' + ' '.repeat(50_000), '()' + ' '.repeat(50_000) + 'x', 'חלב ' + '9 '.repeat(25_000) + '!']) {
      const t0 = performance.now();
      g.translate(evil, 'ar');
      expect(performance.now() - t0, evil.slice(0, 8)).toBeLessThan(100);
    }
  });
});
