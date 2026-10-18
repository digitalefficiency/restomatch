'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/lib/components';

export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
