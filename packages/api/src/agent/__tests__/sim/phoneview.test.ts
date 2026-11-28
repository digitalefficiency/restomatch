/**
 * WA-01 phone view: stable RTL transcripts. The owner files are the E1 pack
 * (design §F.4), ready for the owner to read; the others are review snapshots.
 * Regenerate after an intended change: `vitest run -u src/agent/__tests__/sim/phoneview.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { loadCases, loadRecording } from '../golden/load';
import { normHe } from '../golden/scorer';
import { renderPhone } from './render';
import { RecordedAgent, runCase } from './run';

const cases = loadCases();
const render = async (id: string) => {
  const c = cases.find((x) => x.id === id)!;
  return renderPhone(c, await runCase(c, new RecordedAgent(loadRecording(id))));
};

const PACK: Array<[string, string]> = [
  ['WA-G-OWNER-01', './transcripts/owner/O1-morning-brief.txt'],
  ['WA-G-OWNER-05', './transcripts/owner/O2-request-credit.txt'],
  ['WA-G-OWNER-06', './transcripts/owner/O2-pay-as-charged.txt'],
  ['WA-G-OWNER-08', './transcripts/owner/O3-leak-by-supplier.txt'],
  ['WA-G-OWNER-10', './transcripts/owner/O3-ambiguous-supplier.txt'],
  ['WA-G-RECEIVER-01', './transcripts/snapshots/R1-receiver-day.txt'],
  ['WA-G-RECEIVER-07', './transcripts/snapshots/R2-count-submit.txt'],
  ['WA-G-ADV-01', './transcripts/snapshots/ADV-01-ignore-instructions.txt'],
  ['WA-G-ADV-11', './transcripts/snapshots/ADV-11-replayed-tap.txt'],
];

describe('WA-01 phone view', () => {
  it.each(PACK)('%s matches %s', async (id, file) => {
    await expect(await render(id)).toMatchFileSnapshot(file);
  });

  it('every message line is RTL-marked and the view is deterministic', async () => {
    for (const c of cases) {
      const a = await render(c.id);
      expect(a).toBe(await render(c.id));
      for (const l of a.split('\n')) if (l.length > 0 && !l.startsWith('#')) expect(l.startsWith('‏'), `${c.id}: ${l}`).toBe(true);
      expect(normHe(a)).toBe(normHe(a).normalize('NFC'));
    }
  });
});
