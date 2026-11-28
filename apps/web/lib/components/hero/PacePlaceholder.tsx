import { cnMerge as cn } from '../cn';
import { PACE_BOX } from '../data-viz';

/**
 * The pace line's place while its trend loads (v2 D5): exactly the shared PaceLine's height — its
 * box at the same ratio (the same viewBox) and its legend's one caption line, built as PaceLine
 * builds it (a flex row of one nowrap item, held open by a no-break space: an empty line is 0 px
 * tall) — so nothing moves when the line arrives and the number never waits for it. Decorative.
 * Rendered only where a line can come (the caller's leak month from its 2nd day).
 */
export function PacePlaceholder({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-pace-placeholder="" className={cn('m-0 min-w-0', className)}>
      <svg viewBox={PACE_BOX.viewBox} className="block h-auto w-full" focusable="false" />
      <div className="mt-1 flex text-caption">
        <span className="inline-flex whitespace-nowrap">{' '}</span>
      </div>
    </div>
  );
}
