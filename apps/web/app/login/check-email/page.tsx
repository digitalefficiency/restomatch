import { Mail } from 'lucide-react';
import { Card } from '@/lib/components';

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Mail className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-bold text-ink">בדוק את המייל שלך</h1>
        <p className="text-sm text-muted">
          שלחנו לך קישור התחברות. לחץ עליו כדי להיכנס למערכת. הקישור תקף ל-24 שעות.
        </p>
        <p className="mt-6 text-xs text-subtle">
          ב-development — חפש בשורות log של השרת תחת{' '}
          <code className="font-mono text-primary">──── MAGIC LINK ────</code>.
        </p>
      </Card>
    </main>
  );
}
