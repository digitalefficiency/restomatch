import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  const ctaHref = session?.user?.id ? '/dashboard' : '/login';
  const ctaLabel = session?.user?.id ? 'לדשבורד' : 'כניסה למערכת';

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-right">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-600 font-semibold mb-3">
          RestoMatch
        </p>
        <h1 className="text-5xl font-bold mb-3 text-slate-900 tracking-tight">
          התאמת חשבוניות.
          <br />
          אפס דליפות.
        </h1>
        <p className="text-xl text-slate-500 mb-8 max-w-xl">
          הזמנה ↔ סחורה ↔ חשבונית — המערכת משווה את שלושתן אוטומטית ומראה לך איפה
          כסף בורח.
        </p>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-2.5 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.25)] hover:shadow-[0_6px_20px_rgba(37,99,235,0.35)] transition-all"
        >
          {ctaLabel}
        </Link>
      </div>
    </main>
  );
}
