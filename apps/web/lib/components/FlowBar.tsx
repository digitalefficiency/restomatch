import { cn } from './cn';

/** Money-flow signature motif — an emerald→lime gradient stream. */
export function FlowBar({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-0.5 w-full rounded-full flow-stream', className)} />;
}
