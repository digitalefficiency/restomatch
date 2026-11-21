import { cnMerge as cn } from '../cn';
import { PACE_BOX } from '../data-viz';

/**
 * The pace line's place while its trend loads (v2 D5): the shared PaceLine's box at the same
 * ratio (the same viewBox) and one caption line for its legend, empty, so nothing moves when the
 * line arrives and the number never waits for it. Decorative.
 */
export function PacePlaceholder({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-pace-placeholder="" className={cn('m-0 min-w-0', className)}>
      <svg viewBox={PACE_BOX.viewBox} className="block h-auto w-full" focusable="false" />
      <div className="mt-1 text-caption">{' '}</div>
    </div>
  );
}
