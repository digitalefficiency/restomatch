/**
 * W3-06b · pure rules behind the phone leak-check form (no React, no DOM).
 */

export const MAX_FILES = 10;

/** The submit runs through these stages, in order; the UI shows "{n} מתוך 3". */
export const STAGES = ['challenge', 'pow', 'upload'] as const;
export type Stage = (typeof STAGES)[number];

/** 1-based position of a stage, for the determinate progress ("2 מתוך 3"). */
export function stageNumber(stage: Stage): number {
  return STAGES.indexOf(stage) + 1;
}

type FileKey = Pick<File, 'name' | 'size' | 'lastModified'>;
const keyOf = (f: FileKey) => `${f.name}:${f.size}:${f.lastModified}`;

/**
 * Add newly picked files to the list (a phone picks one photo at a time):
 * skip exact duplicates, keep the order, and stop at MAX_FILES. `dropped`
 * counts what didn't fit, so the form can say so instead of failing on submit.
 */
export function addFiles<T extends FileKey>(current: readonly T[], incoming: readonly T[]): { files: T[]; dropped: number } {
  const seen = new Set(current.map(keyOf));
  const files = [...current];
  let dropped = 0;
  for (const f of incoming) {
    const k = keyOf(f);
    if (seen.has(k)) continue;
    if (files.length >= MAX_FILES) {
      dropped++;
      continue;
    }
    seen.add(k);
    files.push(f);
  }
  return { files, dropped };
}

/** Remove the file at `index` (the ✕ on its thumbnail). */
export function removeFileAt<T>(current: readonly T[], index: number): T[] {
  return current.filter((_, i) => i !== index);
}

/** Thumbnails preview images only; a PDF shows a document tile. */
export function isPreviewable(type: string): boolean {
  return /^image\/(jpeg|png|webp)$/.test(type);
}

/**
 * Where focus goes after the ✕ at `removed` is pressed in a list that had
 * `lengthBefore` files (WCAG 2.4.3 — never drop focus to <body>): the ✕ that
 * slid into the same slot, else the previous one, else -1 = the file picker.
 */
export function focusAfterRemove(removed: number, lengthBefore: number): number {
  const remaining = lengthBefore - 1;
  if (remaining <= 0) return -1;
  return Math.min(removed, remaining - 1);
}
