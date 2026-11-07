/**
 * WA-01 live-model suite: OPT-IN ONLY (`WA_LIVE_MODEL=1`), manual or weekly
 * (WA-11), never in CI. It costs tokens. It writes a score file and is not a
 * pass/fail gate. Format: golden/README.md §Live score file.
 *
 * Interim: it needs WA-02's `runAgent` (`packages/api/src/agent/index.ts`).
 * Until that exists the suite reports what is missing instead of guessing.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases } from './golden/load';

const LIVE = process.env.WA_LIVE_MODEL === '1';
const AGENT = join(__dirname, '..', 'index.ts');

describe.skipIf(!LIVE)('WA-01 live-model suite (opt-in)', () => {
  it('scores every golden case against the live agent and writes the score file', () => {
    expect(existsSync(AGENT), 'WA-02 runAgent (agent/index.ts) is not on this branch yet').toBe(true);
    const out = process.env.WA_SCORE_FILE ?? join(__dirname, 'live-score.json');
    // The WA-02 adapter plugs in here (AgentUnderTest → runCase → scoreCase); see golden/README.md.
    writeFileSync(out, JSON.stringify({ kind: 'live', at: new Date().toISOString(), cases: loadCases().length, byRole: {}, results: [] }, null, 2));
  });
});
