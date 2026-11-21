'use client';

import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from './cn';
import { StatusChip, StatusDot } from './feedback/StatusChip';

export interface AnswerFigure {
  /** A figure from the engine, as shown: a <Money> or a count. Never a number typed into text. */
  value: React.ReactNode;
  /** What it is: "דליפה מתחילת אוקטובר". */
  caption: React.ReactNode;
}

/**
 * An answer from the data (DS3 kit "תשובה מהנתונים"): the question, at most a few figures that
 * come from the engine with their meaning, the facts the answer rests on as grey pills, a quiet
 * tag that says where it came from, and one action. A number appears only if the data produced
 * it: free text never carries an amount.
 */
export function DataAnswer({
  question,
  figures,
  facts = [],
  action,
  className,
}: {
  question: React.ReactNode;
  figures: AnswerFigure[];
  /** Short facts, each one a grey pill: "35 חשבוניות נבדקו". */
  facts?: React.ReactNode[];
  /** The one action (a small secondary button or link). */
  action?: React.ReactNode;
  className?: string;
}) {
  const t = useT(components);
  return (
    <section data-answer="" className={cn('grid gap-3', className)}>
      <p className="text-body-sm text-fg-secondary">{question}</p>
      {figures.length ? (
        <dl className="m-0 grid grid-cols-2 gap-3">
          {figures.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="sr-only">{f.caption}</dt>
              <dd className="m-0">
                <span className="block text-money-card font-normal">{f.value}</span>
                <span aria-hidden="true" className="block text-body-sm text-fg-secondary">
                  {f.caption}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {facts.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {facts.map((f, i) => (
            <StatusChip key={i} tone="neutral" label={f} icon={<StatusDot tone="neutral" size="sm" />} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-fg-tertiary">{t('ds.answer.tag')}</span>
        {action}
      </div>
    </section>
  );
}
