/** The phone view: what the person would see, top to bottom, in RTL. */
import type { GoldenCaseT, OutboundMsgT } from '../golden/schema';
import type { SimRun } from './run';

const RLM = '‏';

function line(s: string): string {
  return `${RLM}${s}\n`;
}

function renderOut(m: OutboundMsgT): string {
  let s = '';
  if (m.kind === 'reaction') return line(`   (תגובה ${m.text})`);
  if (m.kind === 'template' && m.template) s += line(`   ‹תבנית ${m.template.name}›`);
  for (const l of m.text.split('\n')) if (l.length > 0) s += line(`RestoMatch: ${l}`);
  for (const b of m.buttons) s += line(`   [כפתור] ${b.title}`);
  if (m.list) {
    s += line(`   [רשימה: ${m.list.button}]`);
    for (const r of m.list.rows) s += line(`      · ${r.title}`);
  }
  if (m.cta) s += line(`   [CTA ↗] ${m.cta.title}`);
  return s;
}

export function renderPhone(c: GoldenCaseT, run: SimRun): string {
  let s = `# ${c.id} · ${c.flow} · ${c.role} · ${c.title}\n# ${c.seed.scenario} · ${c.seed.today}\n`;
  for (const t of run.turns) {
    const turn = t.input.turn;
    s += '\n';
    if (turn.from === 'system') s += line(`[מערכת ${turn.at}] ${turn.trigger}`);
    else {
      const who = turn.sender === 'binding' ? 'אני' : `אני (${turn.sender})`;
      const fwd = turn.forwarded ? ' [הועבר]' : '';
      if (turn.replayOf !== undefined) s += line(`${who}: (אותה הודעה נשלחה שוב)`);
      else if (turn.text !== undefined) s += line(`${who}${fwd}: ${turn.text}`);
      else if (turn.tap) s += line(`${who}: [הקשה] ${turn.tap.title}`);
      else if (turn.media) s += line(`${who}${fwd}: [${turn.media.kind === 'image' ? 'תמונה' : 'מסמך'}]${turn.media.caption ? ` ${turn.media.caption}` : ''}`);
    }
    if (t.out === null) s += line('   (כפילות: לא טופל שוב)');
    else if (t.out.outbound.length === 0) s += line('   (אין הודעה יוצאת)');
    else for (const m of t.out.outbound) s += renderOut(m);
  }
  return s;
}
