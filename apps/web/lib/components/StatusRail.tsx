'use client';

import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from './cn';

export type RailState = 'done' | 'now' | 'todo';

export interface RailStep {
  key: string;
  /** The status this step stands for: "נשלחה לספק", "ממתינה לתשובה". */
  label: React.ReactNode;
  /** One line under it: a date and channel, or how long it has waited. */
  detail?: React.ReactNode;
  state: RailState;
  /** The one action of the current step ("שלחו תזכורת"). Only the current step has one. */
  action?: React.ReactNode;
}

/**
 * The track of a money document (DS3 kit "מסלול של בקשת זיכוי"): it is always in exactly one
 * status, every change is an event with a date, and the action sits inside the current step, not
 * at the top of the screen. Done steps are ink, the current one is amber (it waits for someone),
 * the rest are open rings. `aria-current="step"` marks the current step; each step also carries
 * its state in words for screen readers.
 */
export function StatusRail({ steps, label, className }: { steps: RailStep[]; label: string; className?: string }) {
  const t = useT(components);
  return (
    <ol aria-label={label} data-status-rail="" className={cn('m-0 grid list-none p-0', className)}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li
            key={s.key}
            data-rail-step={s.state}
            aria-current={s.state === 'now' ? 'step' : undefined}
            className={cn('relative grid gap-0.5 ps-6 text-body-sm', last ? 'pb-0' : 'pb-3.5', s.state === 'todo' ? 'text-fg-tertiary' : 'text-fg-secondary')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute start-0.5 top-1 size-2.5 rounded-full',
                s.state === 'done' && 'bg-fg',
                s.state === 'now' && 'border-[1.5px] border-warn-dot-ring bg-warn-dot ring-4 ring-warn-subtle',
                s.state === 'todo' && 'bg-surface ring-2 ring-inset ring-line-strong',
              )}
            />
            {last ? null : (
              <span
                aria-hidden="true"
                className={cn('absolute bottom-0 start-[0.4375rem] top-[1.125rem] w-px', s.state === 'done' ? 'bg-fg' : 'bg-line')}
              />
            )}
            <b className={cn('text-body-sm', s.state === 'now' ? 'font-semibold text-fg' : s.state === 'done' ? 'font-medium text-fg' : 'font-medium')}>
              {s.label}
              <span className="sr-only"> · {t(`ds.rail.${s.state}`)}</span>
            </b>
            {s.detail ? <span className={s.state === 'now' ? 'text-fg-secondary' : undefined}>{s.detail}</span> : null}
            {s.state === 'now' && s.action ? <span className="mt-1.5 justify-self-start">{s.action}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
