import { cn } from './cn';

/**
 * Signature money-flow accent strip — a thin primary→gold gradient.
 * `direction="leak"` flips to the downward danger gradient for "money leaking".
 * Place at the top of a card/section header (it's `aria-hidden`, decorative).
 */
export function FlowAccent({
  direction = 'flow',
  className,
}: {
  direction?: 'flow' | 'leak';
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-full',
        direction === 'leak' ? 'h-8 w-0.5 leak-gradient' : 'h-0.5 w-full flow-stream',
        className,
      )}
    />
  );
}
