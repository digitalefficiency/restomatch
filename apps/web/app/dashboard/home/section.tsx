import { Suspense as ReactSuspense } from 'react';
import { SectionBoundary } from './section-boundary';

/** Same cast as Toast's Provider: the workspace hoists two @types/react (STATE.md). */
export const Suspense = ReactSuspense as unknown as React.ComponentType<{ fallback?: React.ReactNode; children?: React.ReactNode }>;

/**
 * A home card that streams on its own and fails on its own: each card is its
 * own <Suspense> (layout-true skeleton) inside its own error boundary, so the
 * slowest card never holds the T1 number and a broken one never blanks the page.
 */
export function HomeSection({
  name,
  fallback,
  forceFail,
  children,
}: {
  name: string;
  fallback: React.ReactNode;
  /** Dev/e2e fault injection (see `forcedFailures`). */
  forceFail?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SectionBoundary name={name}>
      <Suspense fallback={fallback}>
        {forceFail ? <ForcedFailure name={name} /> : null}
        {children}
      </Suspense>
    </SectionBoundary>
  );
}

async function ForcedFailure({ name }: { name: string }): Promise<never> {
  throw new Error(`[home] forced failure of section "${name}" (?homeFail)`);
}

/**
 * `?homeFail=vat,needs` makes those sections throw, so e2e can prove a failed
 * card shows "לא נטען · נסו שוב" while the hero still renders. Never honoured
 * in a production build.
 */
export function forcedFailures(sp: Record<string, string | string[] | undefined>): Set<string> {
  if (process.env.NODE_ENV === 'production') return new Set();
  const raw = sp.homeFail;
  const v = Array.isArray(raw) ? raw.join(',') : raw ?? '';
  return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}
