'use client';

import { Delete } from 'lucide-react';
import { PAD_KEYS, type PadKey } from './_keypad';

/**
 * The 3 × 4 number pad of the quantity and spot-check sheets (SPEC §10.3, §5:
 * 64 px keys — 56 on a short phone — and 12 px corners). The keys never take focus from the field (the
 * sheet keeps listening for a hardware keyboard) and are laid out left to right
 * in every language, like a phone's dial pad. The point is off for an item
 * counted in whole units.
 *
 * Promote to shared: the grid of lib/components/overlay/QtyKeypad (DS3-01) is the
 * same pad with a decimal comma and no slot for the sheet's own content; DS3-05
 * needs a decimal point in all six languages (see the pull request).
 */
export function DockKeypad({
  onKey,
  whole = false,
  labels,
}: {
  onKey: (key: PadKey) => void;
  /** Counted in whole units: the decimal point is off. */
  whole?: boolean;
  /** Accessible names: the point and delete keys (digits name themselves). */
  labels: { point: string; del: string };
}) {
  return (
    <div dir="ltr" className="grid grid-cols-3 gap-1.5" data-testid="dock-keypad">
      {PAD_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onKey(k)}
          disabled={k === '.' && whole}
          aria-label={k === 'del' ? labels.del : k === '.' ? labels.point : undefined}
          data-key={k}
          // 64 px on an 844 px phone, 56 on a 667 px one: the whole sheet, note included, fits without moving a key.
          className="num inline-flex h-[clamp(3.5rem,7.6dvh,4rem)] select-none items-center justify-center rounded-card border border-line-strong bg-surface-2 text-metric-md font-medium text-ink transition-colors duration-micro ease-standard active:bg-surface-hover disabled:border-transparent disabled:bg-transparent disabled:text-subtle"
        >
          {k === 'del' ? <Delete className="h-6 w-6" aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  );
}
