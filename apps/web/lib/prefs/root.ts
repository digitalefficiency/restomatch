/**
 * Mirrors the display attributes onto <html> (after hydration), so portals
 * (dialogs, toasts, popovers) rendered outside the provider's wrapper follow
 * the same density and text size, and gives back a function that restores what
 * was there before (the provider unmounts: leaving the screens that mount it,
 * or a nested mount). What was there is PICKED from the known values, never
 * written back as read (DS3 CHANGES.md, fourth correction): anything else is
 * removed. Pure over a `dataset`-like object, so it is testable without a DOM.
 */
export interface DisplayAttrs {
  density: 'compact' | undefined;
  text: 'large' | undefined;
}

type Dataset = Record<string, string | undefined>;

/** Values other code may have put on <html> (the DS2 density modes; the text sizes). */
const DENSITY_VALUES = ['compact', 'default', 'touch'] as const;
const TEXT_VALUES = ['regular', 'large'] as const;

function put(dataset: Dataset, key: 'density' | 'text', value: string | undefined) {
  if (value === undefined) delete dataset[key];
  else dataset[key] = value;
}

export function mirrorDisplayAttrs(dataset: Dataset, attrs: DisplayAttrs): () => void {
  const beforeDensity = DENSITY_VALUES.find((v) => v === dataset.density);
  const beforeText = TEXT_VALUES.find((v) => v === dataset.text);
  put(dataset, 'density', attrs.density);
  put(dataset, 'text', attrs.text);
  return () => {
    put(dataset, 'density', beforeDensity);
    put(dataset, 'text', beforeText);
  };
}
