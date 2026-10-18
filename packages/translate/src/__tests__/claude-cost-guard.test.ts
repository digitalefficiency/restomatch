import { describe, expect, it, vi } from 'vitest';
import { ClaudeTranslator, type MessagesClientLike } from '../claudeTranslator';
import { CLAUDE_ERROR_BACKOFF_MS, CLAUDE_MISS_TTL_MS, CompositeTranslator } from '../composite';

/**
 * Security review (client-ready S2 pass): an untranslatable name must not be
 * re-sent to the paid Claude leg on every page render.
 */
function fakeClient(answer: (ids: number[]) => Array<{ id: number; en: string }>) {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    const msg = (body.messages as Array<{ content: string }>)[0]!.content;
    const payload = JSON.parse(msg.slice(msg.indexOf('['))) as Array<{ id: number }>;
    return { content: [{ type: 'text', text: JSON.stringify({ items: answer(payload.map((p) => p.id)) }) }] };
  });
  return { client: { messages: { create } } as MessagesClientLike, create };
}

const NAME = 'מוצר מסתורי לא מוכר';

describe('CompositeTranslator Claude cost guard', () => {
  it('does not re-ask Claude about a name it did not answer, until the miss TTL passes', async () => {
    let t = 1_000;
    const { client, create } = fakeClient(() => []); // Claude answers nothing
    const tr = new CompositeTranslator({ claude: new ClaudeTranslator({ client }), now: () => t });
    await tr.translateMany([NAME]);
    await tr.translateMany([NAME]);
    await tr.translateMany([NAME]);
    expect(create).toHaveBeenCalledTimes(1);
    t += CLAUDE_MISS_TTL_MS + 1;
    await tr.translateMany([NAME]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('backs off after a Claude failure and logs no invoice text', async () => {
    let t = 0;
    const create = vi.fn(async () => {
      throw new Error('boom');
    });
    const onClaudeError = vi.fn();
    const tr = new CompositeTranslator({
      claude: new ClaudeTranslator({ client: { messages: { create } } }),
      onClaudeError,
      now: () => t,
    });
    await tr.translateMany([NAME]);
    await tr.translateMany([NAME]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(onClaudeError).toHaveBeenCalledTimes(1);
    t += CLAUDE_ERROR_BACKOFF_MS + 1;
    await tr.translateMany([NAME]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('allowClaude:false keeps the call glossary-only', async () => {
    const { client, create } = fakeClient((ids) => ids.map((id) => ({ id, en: 'Mystery item' })));
    const tr = new CompositeTranslator({ claude: new ClaudeTranslator({ client }) });
    const out = await tr.translateMany([NAME], { allowClaude: false });
    expect(create).not.toHaveBeenCalled();
    expect(out.get(NAME)).toBeUndefined();
  });

  it('the default error logger prints only the message, never the request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = Object.assign(new Error('rate limited'), { request: { body: NAME } });
    const tr = new CompositeTranslator({
      claude: new ClaudeTranslator({
        client: {
          messages: {
            create: async () => {
              throw err;
            },
          },
        },
      }),
    });
    await tr.translateMany([NAME]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(NAME);
    warn.mockRestore();
  });
});
