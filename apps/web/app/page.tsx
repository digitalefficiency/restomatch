import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  const ctaHref = session?.user?.id ? '/dashboard' : '/login';
  const ctaLabel = session?.user?.id ? 'לדשבורד' : 'כניסה למערכת';

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-right">
        <div className="mb-3 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold mb-3">
          RestoMatch
        </p>
        <h1 className="text-5xl font-bold mb-3 text-ink tracking-tight">
          התאמת חשבוניות.
          <br />
          אפס דליפות.
        </h1>
        <p className="text-xl text-stone-500 mb-8 max-w-xl">
          הזמנה ↔ סחורה ↔ חשבונית — המערכת משווה את שלושתן אוטומטית ומראה לך איפה
          כסף בורח.
        </p>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-xl px-5 py-2.5 font-medium shadow-[0_4px_12px_rgba(11,94,74,0.25)] hover:shadow-[0_6px_20px_rgba(11,94,74,0.35)] transition-all"
        >
          {ctaLabel}
        </Link>
      </div>
    </main>
  );
}
