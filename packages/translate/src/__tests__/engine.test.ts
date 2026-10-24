import { describe, expect, it, vi } from 'vitest';
import { ClaudeTranslator, type MessagesClientLike } from '../claudeTranslator';
import { CompositeTranslator } from '../composite';
import type { GlossaryEntry } from '../glossary/types';
import { GlossaryTranslator, tokenize } from '../glossaryTranslator';
import { matchKey, normalizeHebrew } from '../normalize';
import { translateUnit, unitLabel } from '../units';

const ENTRIES: GlossaryEntry[] = [
  ['עגבניה', 'tomato'],
  ['עגבניות', 'tomatoes'],
  ['עגבניה שרי', 'cherry tomatoes'],
  ['עגבניות שרי', 'cherry tomatoes'],
  ['חזה עוף', 'chicken breast'],
  ['עוף', 'chicken'],
  ['כבד', 'liver'],
  ['מיץ', 'juice'],
  ['תפוזים', 'orange'],
  ['שמן זית', 'olive oil'],
  ['טרי', 'fresh', 'a'],
  ['טרייה', 'fresh', 'a'],
  ['קפוא', 'frozen', 'a'],
  ['אדום', 'red', 'a'],
  ['גדול', 'large', 'a'],
  ['ארגז', 'case'],
  ['מלח', 'salt'],
  ['פלפל', 'pepper'],
  ['בשמן', 'in oil', 'x'],
  ['טונה', 'tuna'],
  ['קוטג׳', 'cottage cheese'],
  ['חלב', 'milk'],
];

const g = new GlossaryTranslator(ENTRIES);

describe('normalize', () => {
  it('unifies gershayim / geresh / niqqud / maqaf', () => {
    expect(normalizeHebrew('ק״ג')).toBe('ק"ג');
    expect(normalizeHebrew('ק”ג')).toBe('ק"ג');
    expect(normalizeHebrew("ק''ג")).toBe('ק"ג');
    expect(normalizeHebrew('יח׳')).toBe("יח'");
    expect(normalizeHebrew('שָׁלוֹם')).toBe('שלום');
    expect(normalizeHebrew('חסה־אייסברג')).toBe('חסה אייסברג');
    expect(matchKey('קוטג׳')).toBe(matchKey("קוטג'"));
    expect(matchKey('ק״ג')).toBe(matchKey('קג'));
  });
});

describe('units', () => {
  it.each([
    ['ק״ג', 'kg'],
    ['ק"ג', 'kg'],
    ['קג', 'kg'],
    ['גר׳', 'g'],
    ['גרם', 'g'],
    ['ל׳', 'L'],
    ['ליטר', 'L'],
    ['מ״ל', 'ml'],
    ['יח׳', 'unit'],
    ['יחידה', 'unit'],
    ['ארגז', 'case'],
    ['קרטון', 'carton'],
    ['מארז', 'pack'],
    ['שק', 'sack'],
    ['בקבוק', 'bottle'],
    ['פחית', 'can'],
    ['צנצנת', 'jar'],
    ['דלי', 'bucket'],
    ['תבנית', 'tray'],
    ['חבילה', 'package'],
    ['שישייה', 'six-pack'],
    ['חבית', 'keg'],
  ])('%s → %s', (he, en) => {
    expect(translateUnit(he)).toBe(en);
  });

  it('passes non-Hebrew units through and returns null for unknown Hebrew', () => {
    expect(translateUnit('kg')).toBe('kg');
    expect(translateUnit('  ')).toBeNull();
    expect(translateUnit(null)).toBeNull();
    expect(translateUnit('שמשון')).toBeNull();
    expect(unitLabel('שמשון', 'en')).toBe('שמשון');
    expect(unitLabel('ק״ג', 'he')).toBe('ק״ג');
    expect(unitLabel('ק״ג', 'en')).toBe('kg');
  });
});

describe('tokenize', () => {
  it('splits glued numbers, flips %3, keeps Latin and separators', () => {
    const toks = tokenize('חלב %3 1ליטר Tnuva, x12');
    expect(toks.map((t) => `${t.t}:${t.text}`)).toEqual([
      'he:חלב',
      'lit:3%',
      'lit:1',
      'he:ליטר',
      'lit:Tnuva',
      'sep:,',
      'lit:x12',
    ]);
  });
});

describe('GlossaryTranslator', () => {
  it('prefers phrases over tokens', () => {
    expect(g.translate('עגבניה שרי')).toBe('Cherry tomatoes');
    expect(g.translate('חזה עוף')).toBe('Chicken breast');
  });

  it('puts Hebrew post-nominal adjectives before the noun', () => {
    expect(g.translate('חזה עוף טרי')).toBe('Fresh chicken breast');
    expect(g.translate('עגבניה אדום גדול')).toBe('Large red tomato');
  });

  it('reverses construct-state nouns ("מיץ תפוזים" → orange juice)', () => {
    expect(g.translate('מיץ תפוזים')).toBe('Orange juice');
    expect(g.translate('כבד עוף')).toBe('Chicken liver');
  });

  it('renders pack heads with "of"', () => {
    expect(g.translate('ארגז עגבניות שרי')).toBe('Case of cherry tomatoes');
  });

  it('keeps sizes, percentages and brand text; translates units after numbers', () => {
    expect(g.translate('שמן זית Yad Mordechai 1 ל׳')).toBe('Olive oil Yad Mordechai 1 L');
    expect(g.translate('חלב 3% 1 ליטר')).toBe('Milk 3% 1 L');
    expect(g.translate('חזה עוף 2.5ק״ג')).toBe('Chicken breast 2.5 kg');
    expect(g.translate('חלב %3')).toBe('Milk 3%');
  });

  it('handles gershayim/geresh spelling variants', () => {
    expect(g.translate("קוטג'")).toBe('Cottage cheese');
    expect(g.translate('קוטג׳')).toBe('Cottage cheese');
  });

  it('handles the ו prefix ("and") and trailing qualifiers', () => {
    expect(g.translate('מלח ופלפל')).toBe('Salt and pepper');
    expect(g.translate('טונה בשמן')).toBe('Tuna in oil');
  });

  it('hyphenated Hebrew compounds', () => {
    expect(g.translate('חזה-עוף קפוא')).toBe('Frozen chicken breast');
  });

  it('returns null when any Hebrew word is unknown (no half translations)', () => {
    expect(g.translate('חזה עוף מושחם')).toBeNull();
    expect(g.translate('שמשון')).toBeNull();
  });

  it('returns non-Hebrew input as-is and null for empty input', () => {
    expect(g.translate('Coca-Cola 330ml')).toBe('Coca-Cola 330ml');
    expect(g.translate('')).toBeNull();
    expect(g.translate(null)).toBeNull();
  });

  it('is deterministic', () => {
    const a = g.translate('ארגז עגבניות שרי');
    const b = new GlossaryTranslator(ENTRIES).translate('ארגז עגבניות שרי');
    expect(a).toBe(b);
  });
});

function fakeClient(answer: (ids: Array<{ id: number; he: string }>) => unknown): MessagesClientLike & {
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body) {
        calls.push(body);
        const content = (body.messages as Array<{ content: string }>)[0]!.content;
        const payload = JSON.parse(content.slice(content.indexOf('['))) as Array<{ id: number; he: string }>;
        return { content: [{ type: 'text', text: JSON.stringify(answer(payload)) }], stop_reason: 'end_turn' };
      },
    },
  };
}

describe('ClaudeTranslator (mocked SDK — no network)', () => {
  it('sends ONE request with strict JSON schema output and maps ids back', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: `EN:${i.he}` })) }));
    const t = new ClaudeTranslator({ client, model: 'test-model' });
    const out = await t.translateBatch(['א', 'ב', 'א', ' ']);
    expect(client.calls).toHaveLength(1);
    const body = client.calls[0]!;
    expect(body.model).toBe('test-model');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(String(body.system)).toContain('Hebrew to English');
    expect([...out.entries()]).toEqual([
      ['א', 'EN:א'],
      ['ב', 'EN:ב'],
    ]);
  });

  it('defaults to the fast Haiku model', () => {
    const prev = process.env.TRANSLATE_CLAUDE_MODEL;
    delete process.env.TRANSLATE_CLAUDE_MODEL;
    expect(new ClaudeTranslator({ client: fakeClient(() => ({ items: [] })) }).model).toBe('claude-haiku-5-5');
    if (prev !== undefined) process.env.TRANSLATE_CLAUDE_MODEL = prev;
  });

  it('chunks large batches', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: 'x' })) }));
    const t = new ClaudeTranslator({ client, maxBatch: 2 });
    const out = await t.translateBatch(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(client.calls).toHaveLength(3);
    expect(out.size).toBe(5);
  });

  it('ignores unknown ids and empty answers; throws on invalid JSON', async () => {
    const partial = new ClaudeTranslator({
      client: fakeClient(() => ({ items: [{ id: 0, en: 'ok' }, { id: 99, en: 'stray' }, { id: 1, en: ' ' }] })),
    });
    expect([...(await partial.translateBatch(['a', 'b'])).entries()]).toEqual([['a', 'ok']]);

    const broken: MessagesClientLike = {
      messages: { create: async () => ({ content: [{ type: 'text', text: 'not json' }] }) },
    };
    await expect(new ClaudeTranslator({ client: broken }).translateBatch(['a'])).rejects.toThrow();
  });

  it('treats a refusal as an error', async () => {
    const refusing: MessagesClientLike = {
      messages: { create: async () => ({ content: [], stop_reason: 'refusal' }) },
    };
    await expect(new ClaudeTranslator({ client: refusing }).translateBatch(['a'])).rejects.toThrow(/refused/);
  });
});

describe('CompositeTranslator', () => {
  it('glossary first, Claude only for misses, passthrough for non-Hebrew', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: `Claude ${i.he}` })) }));
    const c = new CompositeTranslator({ glossary: g, claude: new ClaudeTranslator({ client }) });
    const out = await c.translateMany(['חזה עוף טרי', 'שמשון', 'Coke', null, 'חזה עוף טרי']);
    expect(out.get('חזה עוף טרי')).toEqual({ en: 'Fresh chicken breast', source: 'glossary' });
    expect(out.get('שמשון')).toEqual({ en: 'Claude שמשון', source: 'claude' });
    expect(out.get('Coke')).toEqual({ en: 'Coke', source: 'passthrough' });
    expect(client.calls).toHaveLength(1);
    const sent = (client.calls[0]!.messages as Array<{ content: string }>)[0]!.content;
    expect(sent).toContain('שמשון');
    expect(sent).not.toContain('חזה');
  });

  it('memoizes — the same name is never sent to Claude twice', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: 'Samson' })) }));
    const c = new CompositeTranslator({ glossary: g, claude: new ClaudeTranslator({ client }) });
    await c.translateMany(['שמשון']);
    await c.translateMany(['שמשון']);
    expect(client.calls).toHaveLength(1);
  });

  it('never throws when Claude fails — the miss just stays untranslated', async () => {
    const onClaudeError = vi.fn();
    const failing: MessagesClientLike = {
      messages: {
        create: async () => {
          throw new Error('timeout');
        },
      },
    };
    const c = new CompositeTranslator({ glossary: g, claude: new ClaudeTranslator({ client: failing }), onClaudeError });
    const out = await c.translateMany(['שמשון', 'חלב']);
    expect(out.has('שמשון')).toBe(false);
    expect(out.get('חלב')?.en).toBe('Milk');
    expect(onClaudeError).toHaveBeenCalledOnce();
  });

  it('works offline with no Claude configured', async () => {
    const c = new CompositeTranslator({ glossary: g });
    expect(c.hasClaude).toBe(false);
    expect(await c.translateOne('שמשון')).toBeNull();
    expect(await c.translateOne('מלח')).toEqual({ en: 'Salt', source: 'glossary' });
  });
});

describe('ClaudeTranslator — EN-8 (thinking off, truncation is retryable)', () => {
  it('sends thinking: disabled', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: 'x' })) }));
    await new ClaudeTranslator({ client }).translateBatch(['א']);
    expect(client.calls[0]!.thinking).toEqual({ type: 'disabled' });
  });

  it('splits a batch that hit max_tokens and retries the halves', async () => {
    const calls: number[] = [];
    const client: MessagesClientLike = {
      messages: {
        async create(body) {
          const content = (body.messages as Array<{ content: string }>)[0]!.content;
          const items = JSON.parse(content.slice(content.indexOf('['))) as Array<{ id: number; he: string }>;
          calls.push(items.length);
          if (items.length > 2) return { content: [{ type: 'text', text: '{"items":[{"id":0,' }], stop_reason: 'max_tokens' };
          return {
            content: [{ type: 'text', text: JSON.stringify({ items: items.map((i) => ({ id: i.id, en: `EN ${i.he}` })) }) }],
            stop_reason: 'end_turn',
          };
        },
      },
    };
    const out = await new ClaudeTranslator({ client }).translateBatch(['a', 'b', 'c', 'd']);
    expect(calls).toEqual([4, 2, 2]);
    expect([...out.values()]).toEqual(['EN a', 'EN b', 'EN c', 'EN d']);
  });

  it('a single name that still truncates throws (composite backs off, retries later)', async () => {
    const client: MessagesClientLike = {
      messages: { create: async () => ({ content: [], stop_reason: 'max_tokens' }) },
    };
    await expect(new ClaudeTranslator({ client }).translateBatch(['a'])).rejects.toThrow(/max_tokens/);
  });
});

describe('CompositeTranslator — EN-BUDGET-1 (beforeClaude gate)', () => {
  it('is NOT called when the glossary covers everything', async () => {
    const gate = vi.fn(() => true);
    const client = fakeClient(() => ({ items: [] }));
    const c = new CompositeTranslator({ glossary: g, claude: new ClaudeTranslator({ client }) });
    await c.translateMany(['חלב', 'מלח', 'Coke'], { beforeClaude: gate });
    expect(gate).not.toHaveBeenCalled();
    expect(client.calls).toHaveLength(0);
  });

  it('is called once when names go to Claude; false keeps it glossary-only', async () => {
    const client = fakeClient((items) => ({ items: items.map((i) => ({ id: i.id, en: 'x' })) }));
    const c = new CompositeTranslator({ glossary: g, claude: new ClaudeTranslator({ client }) });
    const deny = vi.fn(() => false);
    const out = await c.translateMany(['שמשון', 'חלב'], { beforeClaude: deny });
    expect(deny).toHaveBeenCalledTimes(1);
    expect(client.calls).toHaveLength(0);
    expect(out.has('שמשון')).toBe(false);
    const allow = vi.fn(() => true);
    await c.translateMany(['שמשון'], { beforeClaude: allow });
    expect(allow).toHaveBeenCalledTimes(1);
    expect(client.calls).toHaveLength(1);
  });
});
