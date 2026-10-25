import { Children, cloneElement, isValidElement, useId, type ReactElement } from 'react';
import { OctagonAlert } from 'lucide-react';
import { cn } from './cn';

// No width here: fields are full-width unless `fullWidth={false}`, in which case
// the caller's className sets the width. Focus is the global :focus-visible
// outline (the border stays `line-strong`); `aria-invalid` turns the border danger.
// 16 px text on coarse pointers so iOS never zooms into a field.
export const fieldBase =
  'rounded-control border border-line-strong bg-surface px-3 py-2 text-ink placeholder-subtle transition-colors duration-micro aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-subtle [@media(pointer:coarse)]:text-body';

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

/**
 * Field v2 (a11y-11, auth-21): label above, then the hint, then the control,
 * then the error (which replaces nothing — both stay linked). The single child
 * control gets `id`, `aria-describedby` (hint + error) and `aria-invalid`
 * injected, so hints and errors are announced. `optional` marks the minority
 * of fields "(רשות)" — pass the localized text.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Inline error under the control (sets `aria-invalid`). */
  error?: React.ReactNode;
  /** Localized "(רשות)" / "(optional)" suffix for the label. */
  optional?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const auto = useId();
  const controlId = htmlFor ?? `f${auto.replace(/:/g, '')}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  // Inject into a single control: a native input/select/textarea or a component
  // (Input, MoneyInput, DateField…). A wrapper <div> is left alone (no duplicate ids).
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const el = isValidElement(only) ? (only as ReactElement<Record<string, unknown>>) : null;
  const injectable = el && (typeof el.type !== 'string' || ['input', 'select', 'textarea'].includes(el.type));
  const control: React.ReactNode = injectable
    ? (cloneElement(el, {
        id: (el.props.id as string | undefined) ?? controlId,
        'aria-describedby':
          [el.props['aria-describedby'] as string | undefined, hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : (el.props['aria-invalid'] as boolean | undefined),
      }) as unknown as React.ReactNode)
    : children;

  return (
    <div className={className}>
      <label htmlFor={controlId} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
        {optional ? <span className="ms-1 font-normal text-subtle">{optional}</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="-mt-0.5 mb-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm text-danger">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
