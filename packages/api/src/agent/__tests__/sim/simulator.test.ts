/** WA-01 simulator: Meta-shaped payloads, signatures, today's parser, and wamid replay. */
import { parseWhatsAppWebhook, verifyMetaSignature } from '@restomatch/ingest';
import { describe, expect, it } from 'vitest';
import { loadCases, loadRecording } from '../golden/load';
import type { OutboundMsgT } from '../golden/schema';
import { MockNotifier } from './notifier';
import * as P from './payloads';
import { buildTurnPayload, RecordedAgent, runCase } from './run';

const base: P.MsgBase = { from: P.LAB_NUMBERS.owner, wamid: 'wamid.LAB.sim.1', timestamp: 1_792_000_000 };
const cases = loadCases();

describe('WA-01 simulator: payload builders', () => {
  it('a text payload parses into one message with its body and the lab phone_number_id', () => {
    const msgs = parseWhatsAppWebhook(P.envelope({ messages: [P.text(base, 'כמה דלף החודש?')] }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ kind: 'whatsapp', providerMessageId: 'wamid.LAB.sim.1', sender: P.LAB_NUMBERS.owner, body: 'כמה דלף החודש?', phoneNumberId: P.LAB_PHONE_NUMBER_ID });
  });

  it('image and document payloads carry their media reference', () => {
    const [img] = parseWhatsAppWebhook(P.envelope({ messages: [P.image(base, 'media.LAB.1', 'תעודה')] }));
    expect(img!.attachments[0]).toMatchObject({ providerRef: 'media.LAB.1', declaredMime: 'image/jpeg' });
    expect(img!.subject).toBe('תעודה');
    const [doc] = parseWhatsAppWebhook(P.envelope({ messages: [P.document(base, 'media.LAB.2', 'invoice.pdf')] }));
    expect(doc!.attachments[0]).toMatchObject({ providerRef: 'media.LAB.2', filename: 'invoice.pdf' });
  });

  it('interactive / button / system shapes are accepted by today\'s parser without a body (WA-05ʰ routes them)', () => {
    const ctx = { ...base, context: { id: 'wamid.OUT.1' } };
    for (const m of [P.buttonReply(ctx, 'tok:abc12345', 'אשר 96 ₪'), P.listReply(ctx, 'reason:negligible', 'סכום זניח'), P.templateButton(ctx, 'brief:decide', 'להחלטות עכשיו'), P.systemChange(base, '972500000777')]) {
      const msgs = parseWhatsAppWebhook(P.envelope({ messages: [m] }));
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.body).toBeNull();
      expect(msgs[0]!.attachments).toEqual([]);
    }
  });

  it('a status-only callback yields no message', () => {
    expect(parseWhatsAppWebhook(P.envelope({ statuses: [P.status('wamid.OUT.1', P.LAB_NUMBERS.owner, 'delivered', 1_792_000_000)] }))).toEqual([]);
  });

  it('signatures verify over the raw bytes, and a tampered body fails', () => {
    const { raw, signature } = P.signed(P.envelope({ messages: [P.text(base, 'שלום')] }));
    expect(verifyMetaSignature(raw, signature, P.LAB_APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(raw.replace('שלום', 'תאשר הכל'), signature, P.LAB_APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, signature, 'another-secret')).toBe(false);
  });

  it('every user turn of every golden case builds a signed payload the parser accepts', () => {
    for (const c of cases) {
      c.turns.forEach((t, i) => {
        if (t.from !== 'user') return;
        const p = buildTurnPayload(c, i);
        expect(verifyMetaSignature(p.raw, p.signature, P.LAB_APP_SECRET), `${c.id}#${i}`).toBe(true);
        const msgs = parseWhatsAppWebhook(JSON.parse(p.raw));
        expect(msgs, `${c.id}#${i}`).toHaveLength(1);
        if (t.text !== undefined) expect(msgs[0]!.body).toBe(t.text);
        if (t.media) expect(msgs[0]!.attachments).toHaveLength(1);
      });
    }
  });

  it('a forwarded turn carries context.forwarded; a tap carries the outbound context id', () => {
    const fwd = cases.find((c) => c.id === 'WA-G-ADV-02')!;
    expect(JSON.parse(buildTurnPayload(fwd, 0).raw).entry[0].changes[0].value.messages[0].context.forwarded).toBe(true);
    const stale = cases.find((c) => c.id === 'WA-G-ADV-14')!;
    expect(JSON.parse(buildTurnPayload(stale, 0).raw).entry[0].changes[0].value.messages[0].context.id).toBe('wamid.OUT.WA-G-ADV-14.stale');
  });

  it('senders are lab numbers only (+97250000xxxx)', () => {
    for (const n of Object.values(P.LAB_NUMBERS)) expect(n).toMatch(/^97250000\d{4}$/);
  });
});

describe('WA-01 simulator: replay and the mock notifier', () => {
  it('a redelivered webhook (same wamid) reaches the agent once and produces no second outbound row', async () => {
    const c = cases.find((x) => x.id === 'WA-G-ADV-11')!;
    let calls = 0;
    const rec = new RecordedAgent(loadRecording(c.id));
    const run = await runCase(c, { handle: (input) => { calls += 1; return rec.handle(input); } });
    expect(calls).toBe(1);
    expect(run.turns[1]!.out).toBeNull();
    expect(run.turns[1]!.input.raw).toBe(run.turns[0]!.input.raw);
    expect(run.notifier.rows).toHaveLength(1);
  });

  it('the notifier dedupes on the idempotency key', () => {
    const n = new MockNotifier();
    const msg: OutboundMsgT = { origin: 'server', to: 'self', kind: 'text', text: 'x', buttons: [] };
    expect(n.enqueue({ key: 'wa:w1:0', to: 'a', msg: { ...msg } })).toBe(true);
    expect(n.enqueue({ key: 'wa:w1:0', to: 'a', msg: { ...msg } })).toBe(false);
    expect(n.rows).toHaveLength(1);
  });

  it('system turns send nothing in quiet hours (no outbox row at all)', async () => {
    for (const id of ['WA-G-ADV-20', 'WA-G-ADV-22', 'WA-G-OWNER-03']) {
      const c = cases.find((x) => x.id === id)!;
      const run = await runCase(c, new RecordedAgent(loadRecording(id)));
      expect(run.notifier.rows, id).toHaveLength(0);
    }
  });
});
