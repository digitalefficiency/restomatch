/**
 * Mirrors the display attributes onto <html> (after hydration), so portals
 * (dialogs, toasts, popovers) rendered outside the provider's wrapper follow
 * the same density and text size, and gives back a function that restores
 * exactly what was there before (the provider unmounts: leaving the screens
 * that mount it, or a nested mount). Pure over a `dataset`-like object, so it
 * is testable without a DOM.
 */
export interface DisplayAttrs {
  density: 'compact' | undefined;
  textSize: string;
  singleKeys: 'on' | 'off';
}

type Dataset = Record<string, string | undefined>;

const KEYS = ['density', 'textSize', 'singleKeys'] as const;

export function mirrorDisplayAttrs(dataset: Dataset, attrs: DisplayAttrs): () => void {
  const before: Record<(typeof KEYS)[number], string | undefined> = {
    density: dataset.density,
    textSize: dataset.textSize,
    singleKeys: dataset.singleKeys,
  };
  const put = (k: (typeof KEYS)[number], v: string | undefined) => {
    if (v === undefined) delete dataset[k];
    else dataset[k] = v;
  };
  put('density', attrs.density);
  put('textSize', attrs.textSize);
  put('singleKeys', attrs.singleKeys);
  return () => {
    for (const k of KEYS) put(k, before[k]);
  };
}
