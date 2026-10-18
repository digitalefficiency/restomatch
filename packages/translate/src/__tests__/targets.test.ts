import { describe, expect, it, vi } from 'vitest';
import type { MessagesClientLike } from '../claudeTranslator';
import { defaultGlossary } from '../composite';
import { CLAUDE_MISS_TTL_MS } from '../composite';
import { hasHebrew } from '../normalize';
import { TARGET_LOCALES, TargetGlossary } from '../targets';
import { TargetClaudeTranslator, TargetTranslator, targetSystemPrompt } from '../targetTranslator';

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
});
