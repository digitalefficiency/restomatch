import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
  /**
   * Kept for its callers. In the clean finish every card rests on --sh1 (SPEC §4), so this marks the
   * card (`data-elevated`) and changes nothing else.
   */
  elevated?: boolean;
  /** Inner padding shorthand. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Render the signature money-flow gradient as a thin top-accent strip. */
  flow?: boolean;
  /** Border tone. `danger` outlines a T1/T2 card (set here — a border colour in
   *  `className` would fight `border-line`, since `cn` doesn't merge classes). */
  tone?: 'default' | 'danger' | 'warn' | 'info';
  as?: React.ElementType;
}

const paddings = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
} as const;

/**
 * Surface container ("Command Center" language): dark `surface` card on the
 * near-black canvas with a soft `line` hairline border. `elevated` adds the
 * dark soft shadow; `flow` adds the signature money-flow top-accent.
 */
export function Card({
  children,
  className,
  elevated = false,
  padding = 'md',
  flow = false,
  tone = 'default',
  as: Tag = 'div',
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        // SPEC §4 / D6: a card is white, 12 px corners, a 1 px --rule border, resting on --sh1.
        'relative rounded-card border bg-surface',
        tone === 'danger' ? 'border-danger/40' : tone === 'warn' ? 'border-warn/40' : tone === 'info' ? 'border-info/30' : 'border-line-rule',
        flow && 'overflow-hidden',
        'shadow-e1',
        paddings[padding],
        className,
      )}
      data-elevated={elevated || undefined}
      {...rest}
    >
      {flow ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
      ) : null}
      {children}
    </Tag>
  );
}
