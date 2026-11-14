import { cnMerge as cn } from './cn';

/**
 * The key cap (DS3 SPEC §5 "Key cap": 20 px high, 12 px text). Shown inside a button that has a
 * shortcut, in a toast, in a palette footer. Always LTR (a key is not a word) and decorative: the
 * control that owns the shortcut carries `aria-keyshortcuts`, so the name is not read twice.
 * `onBold` is for a key cap on a filled button or the dark toast.
 */
export function Kbd({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'onBold';
  className?: string;
}) {
  return (
    <kbd
      aria-hidden="true"
      data-kbd=""
      className={cn(
        'inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-xs border px-1 text-kbd [direction:ltr] [unicode-bidi:isolate]',
        tone === 'onBold' ? 'border-on-bold/30 bg-on-bold/15 text-on-bold' : 'border-line bg-surface-sunken text-fg-secondary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
