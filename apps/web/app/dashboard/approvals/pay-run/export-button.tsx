'use client';

import { Download } from 'lucide-react';
import { Button } from '@/lib/components';
import { downloadCsv, type CsvColumn, type CsvRow } from '@/lib/components/views';

/** Bookkeeper CSV of the pay run (rows are built on the server, already in the viewer's language). */
export function PayRunExport({ label, filename, columns, rows }: { label: string; filename: string; columns: CsvColumn[]; rows: CsvRow[] }) {
  return (
    <Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-0" onClick={() => downloadCsv(filename, columns, rows)} data-testid="payrun-csv">
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
