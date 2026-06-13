'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button, Card } from '@/lib/components';

/**
 * App-level client error boundary (Ledger style). Catches render/runtime errors
 * in the route segment and offers a retry + a way back home — instead of the
 * default Next.js error overlay.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console for local debugging; observability hooks elsewhere.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Card elevated padding="lg" className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/15">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-ink">משהו השתבש</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-stone-500">
            נתקלנו בתקלה בלתי צפויה. אפשר לנסות שוב — אם הבעיה חוזרת, רעננו את העמוד או חזרו מאוחר
            יותר.
          </p>
          {error.digest ? (
            <p className="mt-3 text-xs tabular-nums text-stone-400">קוד שגיאה: {error.digest}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" onClick={() => reset()}>
            נסו שוב
          </Button>
          <Link href="/dashboard">
            <Button variant="secondary">חזרה לסקירה</Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
