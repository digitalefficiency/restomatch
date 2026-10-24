import { cn } from './cn';

// No width here: `cn` only joins classes (no tailwind-merge), so a default
// `w-full` would beat a caller's `w-20`. Fields are full-width unless
// `fullWidth={false}`, in which case the caller's className sets the width.
const fieldBase =
  'rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink placeholder-subtle transition-colors focus:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed';

type Width = {
  /** Default true. Pass false and a `w-*` class to size the field yourself. */
  fullWidth?: boolean;
};
const width = (fullWidth: boolean) => (fullWidth ? 'w-full' : '');

export function Input({
  className,
  fullWidth = true,
  ...rest
}: React.ComponentPropsWithRef<'input'> & Width) {
  return <input className={cn(fieldBase, width(fullWidth), className)} {...rest} />;
}

export function Textarea({
  className,
  fullWidth = true,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & Width) {
  return <textarea className={cn(fieldBase, width(fullWidth), className)} {...rest} />;
}

/** Native select with the same field chrome as Input (keyboard + screen-reader friendly). */
export function Select({
  className,
  fullWidth = true,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & Width) {
  return <select className={cn(fieldBase, width(fullWidth), 'pe-8', className)} {...rest} />;
}

/** Label + control wrapper with consistent spacing and optional hint. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
