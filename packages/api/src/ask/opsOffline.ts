/**
 * AU-06 offline intents — the five "what needs me" questions answered without
 * Claude, from the SAME tool functions the online leg calls (one code path, two
 * renderers). The API returns facts (numbers, names, links); the web renders
 * the sentence with formatIls(). No money string is built here.
 */
import type { UserRole } from '@restomatch/db';
import type { Database } from '@restomatch/db';
import { runOpsTool, type OpsToolName } from './opsTools';
import { AskToolForbidden, canUseTool, redactForRole } from './roles';
import type { ScreenLink } from './tools';

export const OPS_INTENTS = ['waitingForMe', 'intakeStuck', 'whoOwesMe', 'toPayThisWeek', 'vatAtRisk'] as const;
export type OpsIntent = (typeof OPS_INTENTS)[number];

export function isOpsIntent(intent: string | null): intent is OpsIntent {
  return intent !== null && (OPS_INTENTS as readonly string[]).includes(intent);
}

export const OPS_INTENT_TOOL: Readonly<Record<OpsIntent, OpsToolName>> = {
  waitingForMe: 'waiting_for_me',
  intakeStuck: 'intake_stuck',
  whoOwesMe: 'who_owes_me',
  toPayThisWeek: 'to_pay_this_week',
  vatAtRisk: 'vat_at_risk',
};

/**
 * Keyword rules (he + en), checked BEFORE the leak rules — narrow on purpose so
 * every existing leak phrasing keeps its intent ("מה כדאי לתבוע השבוע?",
 * "על מה לבקש זיכוי?" stay claimWeek). Order: most specific first.
 */
export const OPS_RULES: ReadonlyArray<[OpsIntent, RegExp]> = [
  // מע״מ / מע"מ / מעמ, allocation number.
  ['vatAtRisk', /(מע["״'׳]{0,2}מ|הקצאה|\bvat\b|allocation)/i],
  ['intakeStuck', /(תקוע|נתקע|קליטה|הקליטה|לא נקלט|פוענח|פענוח|\bstuck\b|\bintake\b|\binbox\b)/i],
  ['toPayThisWeek', /(לשלם|לתשלום|תשלום|\bpay\b|\bpayments?\b|\bdue\b)/i],
  ['whoOwesMe', /(חייב|\bowes?\b|\bowed\b|לא ענה|לא ענו|זיכויים? באיחור|overdue credits?)/i],
  ['waitingForMe', /(מחכה|מחכים|ממתין|ממתינים|לאשר|לאישור|להחלטה|waiting for|waits for|to approve|my decision)/i],
];

export function classifyOps(question: string): OpsIntent | null {
  for (const [intent, re] of OPS_RULES) if (re.test(question)) return intent;
  return null;
}

export async function opsOfflineAnswer(
  db: Database,
  restaurantId: string,
  intent: OpsIntent,
  now: Date,
  locale: 'he' | 'en',
  role: UserRole | undefined,
): Promise<{ intent: OpsIntent; facts: Record<string, unknown>; links: ScreenLink[] }> {
  const tool = OPS_INTENT_TOOL[intent];
  // Same role table as the online leg (fails closed on a missing role).
  if (!canUseTool(tool, role)) throw new AskToolForbidden(tool, role);
  const r = await runOpsTool(tool, {}, { db, restaurantId, role, now, locale });
  const out = redactForRole({ data: r.data, links: r.links, figures: { ils: [], pct: [], count: [] } }, role);
  return { intent, facts: out.data as Record<string, unknown>, links: out.links };
}
