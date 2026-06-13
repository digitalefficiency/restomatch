import Link from 'next/link';
import { Receipt } from 'lucide-react';

const navLinks = [
  { href: '/#benefits', label: 'יתרונות' },
  { href: '/pricing', label: 'מחירים' },
  { href: '/about', label: 'אודות' },
];

/**
 * Marketing chrome (nav + footer) shared by the route-group layout AND the
 * root homepage (`app/page.tsx` lives outside the `(marketing)` group, so it
 * can't inherit that layout — it wraps itself in this shell instead).
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="RestoMatch">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-[0_4px_12px_rgba(11,94,74,0.25)]">
              <Receipt className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">RestoMatch</span>
          </Link>

          <nav aria-label="ניווט ראשי" className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-ink"
          >
            כניסה
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-stone-200/70 bg-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5 text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                  <Receipt className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-base font-bold tracking-tight">RestoMatch</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-stone-500">
                הזמנה, קבלת סחורה וחשבונית — מושוות אוטומטית, כדי שאף שקל לא ידלוף
                בקבלת הסחורה.
              </p>
            </div>

            <nav aria-label="קישורי תחתית" className="flex flex-col gap-2 text-sm">
              <span className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                ניווט
              </span>
              <Link href="/#benefits" className="text-stone-600 hover:text-ink">
                יתרונות
              </Link>
              <Link href="/pricing" className="text-stone-600 hover:text-ink">
                מחירים
              </Link>
              <Link href="/about" className="text-stone-600 hover:text-ink">
                אודות
              </Link>
              <Link href="/login" className="text-stone-600 hover:text-ink">
                כניסה למערכת
              </Link>
            </nav>
          </div>

          <div className="mt-10 border-t border-stone-200/70 pt-6 text-xs text-stone-400">
            © {new Date().getFullYear()} RestoMatch. כל הזכויות שמורות.
          </div>
        </div>
      </footer>
    </div>
  );
}
