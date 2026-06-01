import { cn } from './cn';

const fieldBase =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, className)} {...rest} />;
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
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-slate-700">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
