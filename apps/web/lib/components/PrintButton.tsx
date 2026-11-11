'use client';

import { Printer } from 'lucide-react';
import { Button } from './Button';

/** The browser surface print scoping touches (a fake in tests). */
export interface PrintEnv {
  root: { dataset: DOMStringMap };
  querySelectorAll: (sel: string) => ArrayLike<{ setAttribute(n: string, v: string): void; removeAttribute(n: string): void }>;
  addEventListener: (t: 'afterprint', fn: () => void) => void;
  removeEventListener: (t: 'afterprint', fn: () => void) => void;
  print: () => void;
}

/**
 * Print the page, or with `scope` only the element(s) marked
 * `data-print-root={scope}`. Sets `html[data-printing]` (+ `data-print-scope`)
 * and `data-print-active` on the matching roots; the one `@media print` block
 * in globals.css does the rest (A4, white sheet, everything else hidden).
 * Everything is cleared on `afterprint`. Returns the cleanup (for tests).
 */
export function startPrint(env: PrintEnv, scope?: string): () => void {
  const roots = scope ? Array.from(env.querySelectorAll(`[data-print-root="${cssEscape(scope)}"]`)) : [];
  env.root.dataset.printing = '';
  if (scope) env.root.dataset.printScope = scope;
  for (const el of roots) el.setAttribute('data-print-active', '');
  const clear = () => {
    delete env.root.dataset.printing;
    delete env.root.dataset.printScope;
    for (const el of roots) el.removeAttribute('data-print-active');
    env.removeEventListener('afterprint', clear);
  };
  env.addEventListener('afterprint', clear);
  env.print();
  return clear;
}

/** Scope names are ids we write ourselves; still, never let one break the selector. */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/**
 * The one shared print button (replaces the claims and proof copies).
 * `primary` for the page's main action; hidden in the printout itself.
 */
export function PrintButton({ label, primary = false, scope }: { label: string; primary?: boolean; scope?: string }) {
  const print = () =>
    void startPrint(
      {
        root: document.documentElement,
        querySelectorAll: (sel) => document.querySelectorAll(sel),
        addEventListener: (t, fn) => window.addEventListener(t, fn),
        removeEventListener: (t, fn) => window.removeEventListener(t, fn),
        print: () => window.print(),
      },
      scope,
    );
  return (
    <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={print} className="print:hidden" data-print-button="">
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
