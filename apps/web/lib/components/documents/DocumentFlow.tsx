import Link from 'next/link';
import { cn } from '../cn';

export interface FlowNode {
  key: 'po' | 'gr' | 'invoice' | 'claim';
  label: string;
  /** Where the node opens; null = this document doesn't exist (yet). */
  href: string | null;
  /** The node the page is about. */
  current?: boolean;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';

/**
 * W2-02 · the document chain (functional-flows-10): הזמנה → קבלת סחורה →
 * חשבונית → דרישת זיכוי. A missing link reads as "אין" (neutral), never an alarm.
 */
export function DocumentFlow({ nodes, label, missing }: { nodes: FlowNode[]; label: string; missing: string }) {
  return (
    <nav aria-label={label} data-testid="document-flow">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {nodes.map((n, i) => (
          <li key={n.key} className="flex items-center gap-1">
            {i > 0 ? (
              <span aria-hidden="true" className="text-subtle">
                <span className="rtl:hidden">→</span>
                <span className="ltr:hidden">←</span>
              </span>
            ) : null}
            {n.current ? (
              <span aria-current="page" className="rounded-full bg-primary-subtle px-3 py-1 font-semibold text-primary">
                {n.label}
              </span>
            ) : n.href ? (
              <Link href={n.href} className={cn('rounded-full border border-line px-3 py-1 text-ink hover:bg-surface-2', FOCUS)}>
                {n.label}
              </Link>
            ) : (
              <span className="rounded-full border border-dashed border-line px-3 py-1 text-muted">
                {n.label} · {missing}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
