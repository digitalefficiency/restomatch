import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button, Card } from '@/lib/components';

/**
 * 404 page (Ledger style). Rendered by the root layout, so it inherits the
 * warm-paper canvas + RTL.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Card elevated flow padding="lg" className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="font-mono text-sm font-semibold tabular-nums text-primary">404</p>
          <h1 className="mt-1 text-xl font-bold text-ink">העמוד לא נמצא</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
            הכתובת שחיפשתם לא קיימת או הוסרה. בדקו את הקישור או חזרו לעמוד הראשי.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="primary">חזרה לסקירה</Button>
        </Link>
      </Card>
    </main>
  );
}
