import { cn } from '../cn';

/** A why-line piece: plain text, or a number/₪/token isolated in its own `<bdi>`. */
export interface WhyLineSegment {
  text: string;
  num?: boolean;
}

/**
 * "Why was this flagged?" in one line (W1-07, approvals-06):
 *   ₪575.00 × 2 חבית במקום ₪522.60 (הזמנה PO-…, 14.10) = ₪104.80 · +10.0% · סף ±2% או ₪5
 *
 * Groups are joined with " · ". Every number, ₪ amount and token sits in a
 * plain `<bdi>` (no `dir`), tabular, in the body face — so a he-IL ₪ keeps its
 * glyph on the correct side and never drags a neighbour across (DoD-4).
 * `clamp` keeps it to one line in compact density; it is never dropped.
 */
export function WhyLine({
  groups,
  clamp = false,
  className,
  id,
}: {
  groups: WhyLineSegment[][];
  clamp?: boolean;
  className?: string;
  id?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <p
      id={id}
      className={cn('text-sm leading-6 text-muted', clamp && 'line-clamp-1', className)}
      data-testid="why-line"
    >
      {groups.map((g, gi) => (
        <span key={gi}>
          {gi > 0 ? <span aria-hidden="true"> · </span> : null}
          {gi > 0 ? <span className="sr-only">, </span> : null}
          {g.map((s, si) =>
            s.num ? (
              <bdi key={si} className="whitespace-nowrap font-semibold tabular-nums text-ink">
                {s.text}
              </bdi>
            ) : (
              <span key={si}>{s.text}</span>
            ),
          )}
        </span>
      ))}
    </p>
  );
}
