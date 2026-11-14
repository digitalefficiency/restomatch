import { cnMerge as cn } from '../cn';

/**
 * A two-part bar (DS3 kit "גרפים", the leak card's "שולם או לא שולם"): the first part solid, the
 * second hatched on its tint, sized by their shares, so the two parts differ by pattern and not
 * only by colour. It is a picture of figures written beside it (the caller prints the amounts and
 * their links under each part), so it is decorative by default. Values are only proportions: no
 * money is computed here.
 */
export function SplitBar({
  first,
  second,
  tone = 'leak',
  label,
  className,
}: {
  first: number;
  second: number;
  /** `leak` (the leak card) or `neutral`. */
  tone?: 'leak' | 'neutral';
  /** Give it a name only when no figures sit beside it. */
  label?: string;
  className?: string;
}) {
  const a = Math.max(0, first);
  const b = Math.max(0, second);
  const solid = tone === 'leak' ? 'bg-danger-bold' : 'bg-fg-secondary';
  const hatch =
    tone === 'leak'
      ? 'border border-danger-subtle bg-danger-subtle bg-[repeating-linear-gradient(135deg,rgb(var(--c-danger-bold))_0_1.5px,transparent_1.5px_6px)]'
      : 'border border-line bg-surface-sunken bg-[repeating-linear-gradient(135deg,rgb(var(--c-text-secondary))_0_1.5px,transparent_1.5px_6px)]';
  return (
    <div
      data-split-bar=""
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('flex h-3 gap-0.5', className)}
    >
      {a > 0 ? <i className={cn('block rounded-xs', solid)} style={{ flexGrow: a, flexBasis: 0 }} /> : null}
      {b > 0 ? <i className={cn('block rounded-xs', hatch)} style={{ flexGrow: b, flexBasis: 0 }} /> : null}
    </div>
  );
}
