import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/components';

const TONE = {
  // T2-ish: a failed attempt the user must act on.
  error: { box: 'border-danger bg-danger/5 text-danger', Icon: AlertCircle, role: 'alert' },
  // Calm confirmation.
  success: { box: 'border-primary bg-primary/5 text-primary', Icon: CheckCircle2, role: 'status' },
  // T4 neutral — information, never an alarm.
  neutral: { box: 'border-line-strong bg-surface-2 text-ink', Icon: Info, role: 'status' },
} as const;

/** One inline message style for every auth screen (error · success · neutral). */
export function Notice({
  tone,
  children,
  className,
  id,
}: {
  tone: keyof typeof TONE;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const { box, Icon, role } = TONE[tone];
  return (
    <div id={id} role={role} className={cn('mb-4 flex items-start gap-2 rounded-md border-s-4 px-3 py-2 text-sm', box, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
