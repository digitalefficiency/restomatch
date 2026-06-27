import Link from 'next/link';
import { Card } from '@/lib/components';

/**
 * Second-factor (TOTP) screen — placeholder.
 *
 * The middleware 2FA session gate (Epic B.2 plumbing) routes a 2FA-enrolled
 * user here after their first factor (password OR magic-link). The full
 * enrollment + verify flow ships in Epic C (C.1); until then this page only
 * exists so the gate has a non-404 destination. It is INERT today because no
 * user has totp_enabled_at set, so the gate never fires.
 */
export default function TwoFactorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold text-ink">אימות דו-שלבי</h1>
        <p className="mb-6 text-sm text-muted">
          אימות דו-שלבי (TOTP) יופעל בקרוב. אם הגעתם לכאן, פנו לתמיכה.
        </p>
        <Link href="/login" className="text-sm text-brand hover:underline">
          חזרה לכניסה
        </Link>
      </Card>
    </main>
  );
}
