import { COPY, FILM, ilsText, LINES, Locale, risePct, SAMPLE } from './copy';

/**
 * The film's text alternative (WCAG 1.2.1 — the film is silent, so this is a scene description):
 * one line per beat, built from the same COPY + SAMPLE/FILM the frames are drawn from, so the
 * description can't drift from the picture. scripts/transcript.mjs writes it to
 * apps/web/app/(marketing)/_components/promoTranscript.json for the site's film dialog.
 */
export type TranscriptLine = { at: string; text: string };

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

export const transcript = (locale: Locale): TranscriptLine[] => {
  const c = COPY[locale];
  const ils = (n: number, d = 0) => ilsText(n, locale, d);
  const he = locale === 'he';
  const p = c.product;
  const keg = fill(p.chipBeer, { from: ils(FILM.keg.usual, 2), to: ils(FILM.keg.latest, 2) });
  return [
    {
      at: '0:00',
      text: `${c.sampleTag}. ${c.hook.l1} ${c.hook.l2} ${c.hook.l3} ${ils(SAMPLE.leak)}. ${c.hook.sub}`,
    },
    { at: '0:06', text: `${c.problem.t1} ${c.problem.t2} ${c.problem.t3}` },
    { at: '0:12', text: c.match.line },
    {
      at: '0:15',
      text: `${p.heroTitle} ${p.heroSub} ${c.sample.eyebrow}. ${c.sample.label}: ${ils(SAMPLE.leak)}, ${fill(c.sample.pct, { pct: `${SAMPLE.leakPct}%` })}, ${fill(c.sample.base, { amount: ils(SAMPLE.purchasing) })}.`,
    },
    { at: '0:21', text: `${p.heatTitle}. ${p.heatSub} ${keg} (${risePct(FILM.keg.usual, FILM.keg.latest)}).` },
    {
      at: '0:25',
      text: `${p.apprTitle} ${p.apprSub} ${c.sample.decide}: ${ils(SAMPLE.decide.amount)} (${fill(c.sample.gaps, { count: SAMPLE.decide.count })}).`,
    },
    {
      at: '0:29',
      text: `${p.claimTitle}. ${p.claimSub} ${c.sample.credit}: ${ils(SAMPLE.credit.amount)} (${fill(c.sample.gaps, { count: SAMPLE.credit.count })}).`,
    },
    {
      at: '0:33',
      text: he
        ? `${c.receiver.title} ${c.receiver.title2} ${c.receiver.sub} לדוגמה: ${LINES[0].he} ← ${LINES[0].en}; הוזמנו ${FILM.delivery.ordered} ק״ג, הגיעו ${FILM.delivery.received} ק״ג.`
        : `${c.receiver.title} ${c.receiver.title2} ${c.receiver.sub} For example: ${LINES[0].he} → ${LINES[0].en}; ${FILM.delivery.ordered} kg ordered, ${FILM.delivery.received} kg received.`,
    },
    {
      at: '0:41',
      text: `${c.value.eyebrow}. ${c.value.leak}: ${ils(SAMPLE.leak)}. ${c.value.caught}: ${ils(SAMPLE.unpaid)}. ${c.value.claimed}: ${ils(SAMPLE.credit.amount)}. ${c.value.calm} ${c.value.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`,
    },
    { at: '0:55', text: `RestoMatch — ${c.cta.tagline}. ${c.cta.action}.` },
  ];
};
