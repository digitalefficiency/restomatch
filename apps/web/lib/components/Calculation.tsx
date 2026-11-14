'use client';

import { Box, Eye, FileText, PencilLine, ShoppingCart } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from './cn';
import { ExplainToggle, useDisclosure, type ExplainLabel } from './Explain';

/** Where a number came from. `scan` is a value read from a photo of a document (the eye). */
export type CalcSourceKind = 'scan' | 'count' | 'order' | 'invoice' | 'manual';

export interface CalcSource {
  /** The number as shown: a quantity string, or a <Money split />. */
  value: React.ReactNode;
  kind: CalcSourceKind;
  /** One short line: "נקרא מהחשבונית, שורה 2", "נספר בקבלה, 15.10.2026". */
  text: React.ReactNode;
}

const SOURCE_ICON: Record<CalcSourceKind, typeof Eye> = {
  scan: Eye,
  count: Box,
  order: ShoppingCart,
  invoice: FileText,
  manual: PencilLine,
};

const OPERATOR = { times: '×', plus: '+', minus: '−' } as const;

/**
 * "Where the amount comes from" (DS3 kit "מאיפה הסכום"; SPEC §1.2): a computed amount opened to
 * its formula with the real numbers ("3 ק״ג × ₪12.90 = ₪38.70"), and beside each number where it
 * came from — an eye marks a value read from a scan. Unlike <Explain> (text only, no ₪), this is
 * the calculation itself. It formats nothing: every figure arrives formatted (a <Money> or a
 * quantity string), so no ₪ is built here and nothing is computed in the client.
 */
export function Calculation({
  terms,
  operator = 'times',
  result,
  sources = [],
  className,
}: {
  /** The operands as shown, in reading order: ['3 ק״ג', <Money value={12.9} split />]. */
  terms: React.ReactNode[];
  operator?: keyof typeof OPERATOR;
  /** The amount the formula gives, as shown (it is the figure this explains). */
  result: React.ReactNode;
  sources?: CalcSource[];
  className?: string;
}) {
  const op = OPERATOR[operator];
  return (
    <div data-calculation="" className={cn('min-w-0', className)}>
      <p className="num flex flex-wrap items-baseline gap-2 border-b border-line-rule pb-2.5 text-body" data-calc-formula="">
        {terms.map((term, i) => (
          <span key={i} className="inline-flex items-baseline gap-2">
            {i > 0 ? (
              <span aria-hidden="true" className="text-fg-tertiary">
                {op}
              </span>
            ) : null}
            <span>{term}</span>
          </span>
        ))}
        <span aria-hidden="true" className="text-fg-tertiary">
          =
        </span>
        <b className="text-title-sm font-semibold">{result}</b>
      </p>
      {sources.length ? (
        <dl className="mt-2 grid">
          {sources.map((s, i) => {
            const Icon = SOURCE_ICON[s.kind];
            return (
              <div key={i} data-calc-source={s.kind} className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2.5 py-1.5 text-body-sm">
                <dt className="num font-medium">{s.value}</dt>
                <dd className="m-0 flex items-center gap-1.5 text-fg-secondary">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" aria-hidden="true" />
                  <span className="min-w-0">{s.text}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * The calculation behind a visible toggle ("איך חישבנו?"), opened in place below the line it
 * explains — the same disclosure as <Explain>: collapsed on the server and the client (no layout
 * shift), focus stays on the toggle, the panel follows the toggle's row in DOM order.
 */
export function CalculationFold({
  line,
  about,
  label = 'how',
  id,
  children,
  className,
}: {
  /** The visible figure or sentence this explains; omit to place the toggle alone. */
  line?: React.ReactNode;
  /** ≤4 words, unique on the page: the screen-reader suffix of the toggle's name. */
  about: string;
  label?: ExplainLabel;
  id?: string;
  /** Usually a <Calculation>. */
  children: React.ReactNode;
  className?: string;
}) {
  const d = useDisclosure(id);
  const t = useT(components);
  return (
    <div className={cn('min-w-0', className)} data-calculation-fold="">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {line ? <div className="min-w-0">{line}</div> : null}
        <ExplainToggle {...d.toggleProps} label={label} about={about} />
      </div>
      <div
        id={d.panelProps.id}
        hidden={d.panelProps.hidden}
        ref={d.panelProps.ref}
        aria-label={t('ds.calc.panel')}
        role="group"
        className="mt-1 max-w-prose rounded-control border border-line bg-surface p-3 print:!block"
      >
        {children}
      </div>
    </div>
  );
}
