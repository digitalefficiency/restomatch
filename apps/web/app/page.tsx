import Link from 'next/link';
import { auth } from '@/auth';

export default async function Home() {
  const session = await auth();
  const ctaHref = session?.user?.id ? '/dashboard' : '/login';
  const ctaLabel = session?.user?.id ? 'לדשבורד' : 'כניסה למערכת';

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl text-right">
        <h1 className="text-5xl font-bold mb-3 text-white tracking-tight">RestoMatch</h1>
        <p className="text-xl text-neutral-400 mb-8">
          התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות.
        </p>
        <Link
          href={ctaHref}
          className="inline-block bg-primary hover:bg-primary-hover rounded-md px-5 py-2.5 font-medium transition-colors"
        >
          {ctaLabel}
        </Link>
      </div>
    </main>
  );
}
