// DS2 legacy-pattern counters for the ratchet (docs/ux/ds2/DS2-SPEC.md §5.6).
// REPORT-ONLY until phase 5: a count that goes up is printed, never failed.
// Counted over apps/web source (app, lib, components), tests and e2e excluded.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Metric {
  /** What the count tracks, and the DS2 rule that retires it. */
  why: string;
  pattern: RegExp;
  /** File extensions the metric reads. */
  ext: string[];
}

const TS = ['.ts', '.tsx'];

export const METRICS: Record<string, Metric> = {
  font_mono_total: { why: 'N2: mono only for IDs, never money', pattern: /\bfont-mono\b/g, ext: TS },
  dir_ltr: { why: 'N4: never wrap a Hebrew ₪ string in dir="ltr"', pattern: /\bdir=["']ltr["']/g, ext: TS },
  v1_opacity_tints: {
    why: 'C7: /N status tints move to the -subtle roles',
    pattern: /\b(?:bg|border|ring|text|fill|stroke|outline|divide|from|via|to)-(?:primary|danger|warn|gold|info|neutral)(?:-[a-z]+)*\/\d+\b/g,
    ext: TS,
  },
  hex_in_tsx: { why: 'colours come from tokens', pattern: /#[0-9A-Fa-f]{6}\b/g, ext: ['.tsx'] },
  legacy_focus_visible_ring2: { why: 'one focus ring (border.focus)', pattern: /\bfocus-visible:ring-2\b/g, ext: TS },
  transition_all: { why: '§2.6: transition named properties only', pattern: /\btransition-all\b/g, ext: TS },
  sub12px_text: { why: '§2.1.2 rule 1: 12 px desk floor', pattern: /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g, ext: TS },
  tracking_classes: { why: '§2.1.2 rule 3: Hebrew is never tracked', pattern: /\btracking-(?:tight|tighter|wide|wider|widest)\b/g, ext: TS },
  uppercase: { why: '§2.1.2 rule 3: Hebrew is never uppercased', pattern: /\buppercase\b/g, ext: TS },
  native_date_inputs: { why: 'N10: DateField, never type="date"', pattern: /\btype=["']date["']/g, ext: TS },
  shadow_card: { why: '§2.5: e0 is the default; shadow-card on list cards retires', pattern: /\bshadow-card\b/g, ext: TS },
  glow_rings: { why: '§2.5: shadow-glow-* deleted', pattern: /\bshadow-glow-[a-z]+\b/g, ext: TS },
  glow_blobs: { why: '§2.5: glow-*-blob deleted', pattern: /\bglow-[a-z]+-blob\b/g, ext: [...TS, '.css'] },
  flow_stream_accents: { why: '§2.5: flow-stream / FlowAccent / FlowBar deleted', pattern: /\b(?:flow-stream|FlowAccent|FlowBar)\b/g, ext: TS },
  rounded_2xl: { why: 'D6: cards move to rounded-card (12)', pattern: /\brounded-2xl\b/g, ext: TS },
};

const ROOTS = ['app', 'lib', 'components'];
const SKIP = /(?:^|\/)(?:__tests__|e2e|node_modules|\.next)(?:\/|$)/;

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** Current counts over `webRoot` (the apps/web directory). */
export function countMetrics(webRoot: string): Record<string, number> {
  const files: string[] = [];
  for (const r of ROOTS) walk(join(webRoot, r), files);
  const counts: Record<string, number> = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.'));
    const src = readFileSync(f, 'utf8');
    for (const [name, m] of Object.entries(METRICS)) {
      if (!m.ext.includes(ext)) continue;
      counts[name]! += src.match(m.pattern)?.length ?? 0;
    }
  }
  return counts;
}

/** Metrics whose count went above the baseline (report only before phase 5). */
export function regressions(baseline: Record<string, number>, current: Record<string, number>): Array<{ metric: string; baseline: number; current: number }> {
  return Object.entries(current)
    .filter(([k, n]) => baseline[k] !== undefined && n > baseline[k]!)
    .map(([metric, n]) => ({ metric, baseline: baseline[metric]!, current: n }));
}
