/**
 * WA-01 simulator: replays a golden case as signed Meta webhook payloads through
 * an agent under test, collects outbound rows in a mock notifier, and prints
 * the phone view.
 *
 *   pnpm --filter @restomatch/api exec tsx src/agent/__tests__/sim/run.ts WA-G-OWNER-01
 *
 * Interim (WA-02 not on `main`): the agent under test is a `RecordedAgent`
 * that replays `recorded/<id>.json`. When WA-02 lands, a WA-02 adapter
 * implements the same `AgentUnderTest` interface against the lab DB.
 */
import { parseWhatsAppWebhook, verifyMetaSignature, type InboundMessage } from '@restomatch/ingest';
import { loadCases, loadRecording } from '../golden/load';
import type { GoldenCaseT, GoldenTurn, RecordedTurnT, RecordingT } from '../golden/schema';
import { MockNotifier } from './notifier';
import * as P from './payloads';
import { renderPhone } from './render';

export interface SimInbound {
  turnIndex: number;
  wamid: string;
  /** Who sent it, as resolved from the verified number (never from the payload body). */
  sender: P.MsgBase['from'];
  /** Raw webhook bytes + signature (system turns have none). */
  raw: string | null;
  signature: string | null;
  /** What today's ingest parser makes of it (text/image/document only). */
  parsed: InboundMessage[];
  turn: GoldenTurn;
}

export interface AgentUnderTest {
  handle(input: SimInbound, c: GoldenCaseT): Promise<RecordedTurnT> | RecordedTurnT;
}

/** Replays a recording turn by turn (CI: no network, no model). */
export class RecordedAgent implements AgentUnderTest {
  constructor(private readonly rec: RecordingT) {}
  handle(input: SimInbound): RecordedTurnT {
    const t = this.rec.turns[input.turnIndex];
    if (!t) throw new Error(`${this.rec.caseId}: no recorded turn ${input.turnIndex}`);
    return t;
  }
}

export interface SimTurn {
  input: SimInbound;
  /** null = deduplicated (same wamid seen before): the agent was not called. */
  out: RecordedTurnT | null;
}

export interface SimRun {
  caseId: string;
  turns: SimTurn[];
  notifier: MockNotifier;
}

export function wamidFor(caseId: string, i: number): string {
  return `wamid.LAB.${caseId}.${i}`;
}

function unixAt(day: string, hhmm = '09:30'): number {
  return Math.floor(new Date(`${day}T${hhmm}:00+02:00`).getTime() / 1000);
}

/** Builds the signed webhook for one user turn. */
export function buildTurnPayload(c: GoldenCaseT, i: number): { wamid: string; from: string; raw: string; signature: string } {
  const t = c.turns[i];
  if (!t || t.from !== 'user') throw new Error(`${c.id}: turn ${i} is not a user turn`);
  if (t.replayOf !== undefined) return buildTurnPayload(c, t.replayOf); // identical bytes, identical wamid
  const from = t.sender === 'binding' ? P.LAB_NUMBERS[c.role] : P.LAB_NUMBERS[t.sender];
  const wamid = wamidFor(c.id, i);
  const contextId = t.tap
    ? t.tap.context === 'last'
      ? `wamid.OUT.${c.id}.${i - 1}`
      : t.tap.context === 'stale'
        ? `wamid.OUT.${c.id}.stale`
        : `wamid.OUT.foreign`
    : undefined;
  const m: P.MsgBase = {
    from,
    wamid,
    timestamp: unixAt(c.seed.today, t.at),
    ...(contextId || t.forwarded ? { context: { ...(contextId ? { id: contextId } : {}), ...(t.forwarded ? { forwarded: true } : {}) } } : {}),
  };
  let msg: Record<string, unknown>;
  if (t.text !== undefined) msg = P.text(m, t.text);
  else if (t.media) {
    msg =
      t.media.kind === 'image'
        ? P.image(m, `media.LAB.${c.id}.${i}`, t.media.caption)
        : P.document(m, `media.LAB.${c.id}.${i}`, 'invoice.pdf', t.media.caption);
  } else if (t.tap) {
    msg =
      t.tap.kind === 'list_reply'
        ? P.listReply(m, t.tap.id, t.tap.title)
        : t.tap.kind === 'template_button'
          ? P.templateButton(m, t.tap.id, t.tap.title)
          : P.buttonReply(m, t.tap.id, t.tap.title);
  } else throw new Error(`${c.id}: turn ${i} has no content`);
  const { raw, signature } = P.signed(P.envelope({ messages: [msg] }));
  return { wamid, from, raw, signature };
}

export async function runCase(c: GoldenCaseT, agent: AgentUnderTest): Promise<SimRun> {
  const notifier = new MockNotifier();
  const seen = new Set<string>();
  const turns: SimTurn[] = [];
  for (let i = 0; i < c.turns.length; i++) {
    const t = c.turns[i]!;
    let input: SimInbound;
    if (t.from === 'system') {
      input = { turnIndex: i, wamid: `sys.${c.id}.${i}`, sender: 'system', raw: null, signature: null, parsed: [], turn: t };
    } else {
      const p = buildTurnPayload(c, i);
      if (!verifyMetaSignature(p.raw, p.signature, P.LAB_APP_SECRET)) throw new Error(`${c.id}: bad signature on turn ${i}`);
      input = { turnIndex: i, wamid: p.wamid, sender: p.from, raw: p.raw, signature: p.signature, parsed: parseWhatsAppWebhook(JSON.parse(p.raw)), turn: t };
    }
    // G-05 / inbound unique index: one wamid is processed once.
    if (seen.has(input.wamid)) {
      turns.push({ input, out: null });
      continue;
    }
    seen.add(input.wamid);
    const out = await agent.handle(input, c);
    out.outbound.forEach((msg, n) => notifier.enqueue({ key: `wa:${input.wamid}:${n}`, to: input.sender, msg }));
    turns.push({ input, out });
  }
  return { caseId: c.id, turns, notifier };
}

/** A sim run in recording shape, so the same scorer grades it (effects come from the agent's own report). */
export function runAsRecording(run: SimRun, rec: RecordingT): RecordingT {
  return {
    ...rec,
    turns: run.turns.map((t) => t.out ?? { intent: null, toolCalls: [], outbound: [] }),
  };
}

async function main(id: string | undefined): Promise<void> {
  const c = loadCases().find((x) => x.id === id);
  if (!c) {
    console.error(`usage: run.ts <caseId>  (unknown case: ${String(id)})`);
    process.exitCode = 1;
    return;
  }
  const run = await runCase(c, new RecordedAgent(loadRecording(c.id)));
  process.stdout.write(renderPhone(c, run));
}

if (process.argv[1]?.endsWith('run.ts')) void main(process.argv[2]);
