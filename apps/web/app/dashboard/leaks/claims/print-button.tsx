'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/lib/components';

export function PrintButton({ label, primary = false }: { label: string; primary?: boolean }) {
  return (
    <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
