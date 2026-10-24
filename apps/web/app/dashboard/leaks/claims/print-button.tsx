'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/lib/components';

/**
 * Prints the page — or, with `scope`, only the element marked
 * `data-print-root={scope}` (globals.css hides everything else while it prints).
 */
export function PrintButton({ label, primary = false, scope }: { label: string; primary?: boolean; scope?: string }) {
  const print = () => {
    if (!scope) return window.print();
    const root = document.documentElement;
    root.dataset.printScope = scope;
    const clear = () => {
      delete root.dataset.printScope;
      window.removeEventListener('afterprint', clear);
    };
    window.addEventListener('afterprint', clear);
    window.print();
  };
  return (
    <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={print} className="print:hidden">
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
