/**
 * WA-01: every golden case and recording parses; counts per role; the
 * never-list coverage map is complete and matches golden/README.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseFiles, GOLDEN_DIR, loadCases, loadRecording, readRaw, RECORDED_DIR, recordingFiles } from './golden/load';
import { NEVER_LIST } from './golden/neverList';
import { GoldenCase, OWNER_RULES, ROLES, WD2_CAP_AGOROT_FIXTURE } from './golden/schema';

const cases = loadCases();

describe('WA-01 golden set: schema', () => {
  it('every case file parses and is named <id>.json', () => {
    for (const f of caseFiles()) {
      const r = GoldenCase.safeParse(readRaw(GOLDEN_DIR, f));
      expect(r.success, `${f}: ${r.success ? '' : r.error.message}`).toBe(true);
    }
  });

  it('ids are unique', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('every case has exactly one recording with one entry per turn, and no orphan recordings', () => {
    expect(recordingFiles()).toEqual(caseFiles());
    for (const c of cases) {
      const rec = loadRecording(c.id);
      expect(rec.caseId).toBe(c.id);
      expect(rec.turns, c.id).toHaveLength(c.turns.length);
    }
  });

  it('≥80 cases, ≥20 adversarial, ≥12 per role', () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    expect(cases.filter((c) => c.adversarial).length).toBeGreaterThanOrEqual(20);
    for (const role of ROLES) {
      const n = cases.filter((c) => !c.adversarial && c.role === role).length;
      expect(n, role).toBeGreaterThanOrEqual(12);
    }
  });

  it('every adversarial case asserts the agent is ON and an effect that must not happen', () => {
    for (const c of cases.filter((x) => x.adversarial)) {
      expect(c.seed.features.whatsappAgent, c.id).toBe(true);
      expect(Object.keys(c.expect.state).length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('WA-01 golden set: coverage', () => {
  it('every never-list item (design §C.8) has ≥1 adversarial case', () => {
    for (const n of Object.keys(NEVER_LIST).map(Number)) {
      const ids = cases.filter((c) => c.adversarial && c.neverList.includes(n)).map((c) => c.id);
      expect(ids.length, `never-list item ${n}: ${NEVER_LIST[n]}`).toBeGreaterThan(0);
    }
  });

  it('every owner rule is exercised by ≥1 case', () => {
    for (const r of OWNER_RULES) expect(cases.some((c) => c.ownerRules.includes(r)), r).toBe(true);
  });

  it('golden/README.md never-list table matches the cases', () => {
    const readme = readFileSync(join(GOLDEN_DIR, '..', 'README.md'), 'utf8');
    for (const n of Object.keys(NEVER_LIST).map(Number)) {
      const row = readme.split('\n').find((l) => l.startsWith(`| ${n} |`));
      expect(row, `README row for item ${n}`).toBeDefined();
      const listed = (row!.match(/WA-G-ADV-\d{2}/g) ?? []).sort();
      const actual = cases.filter((c) => c.adversarial && c.neverList.includes(n)).map((c) => c.id).sort();
      expect(listed, `README item ${n}`).toEqual(actual);
    }
    expect(readme).toContain(`**${cases.length} cases**`);
    expect(readme).toContain(`**${cases.filter((c) => c.adversarial).length} adversarial**`);
  });

  it('the WD2 pair exists: exactly the cap stages a token, one agora above gets no confirm button', () => {
    const atCap = cases.filter((c) => loadRecording(c.id).staged.some((s) => s.amountAgorot === WD2_CAP_AGOROT_FIXTURE));
    expect(atCap.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.expect.noButtons.includes('אשר 500.01 ₪') && c.expect.state.stagedTokens === 0)).toBe(true);
  });

  it('the brief\'s named cases exist (link-named supplier, forward, foreign context, day 6/7/8)', () => {
    const titles = cases.map((c) => c.title).join('\n');
    expect(titles).toMatch(/www\.x\.co\.il/);
    expect(cases.some((c) => c.turns.some((t) => t.from === 'user' && t.forwarded))).toBe(true);
    expect(cases.some((c) => c.turns.some((t) => t.from === 'user' && t.tap?.context === 'stale'))).toBe(true);
    expect(cases.some((c) => JSON.stringify(c.seed.overrides).includes('[6,7,8]'))).toBe(true);
  });
});

describe('WA-01 golden set: hygiene', () => {
  const blobs = [...caseFiles().map((f) => readFileSync(join(GOLDEN_DIR, f), 'utf8')), ...recordingFiles().map((f) => readFileSync(join(RECORDED_DIR, f), 'utf8'))];

  it('no model identifiers in the data', () => {
    for (const b of blobs) expect(b).not.toMatch(/claude|opus|sonnet|haiku|gpt-|gemini|fable/i);
  });

  it('only lab phone numbers and known fake identifiers', () => {
    const allowed = [/^\+?97250000\d{4}$/, /^\+?9725211101\d{2}$/, /^0500000\d{3}$/, /^054000000\d$/, /^12-345-678901$/, /^000000018$/, /^482913$/];
    for (const b of blobs) {
      const text = decodeURIComponent(b.replace(/%(?![0-9A-F]{2})/gi, '%25'));
      for (const m of text.match(/\+?\d[\d-]{7,}\d/g) ?? []) {
        if (/^\d{4}-\d{2}-\d{2}/.test(m) || /^\d{4}-\d{2}$/.test(m)) continue; // dates
        expect(allowed.some((rx) => rx.test(m)), `unexpected number ${m}`).toBe(true);
      }
    }
  });
});
