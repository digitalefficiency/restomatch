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
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="RestoMatch">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-on-primary shadow-glow-primary">
              <Receipt className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight">RestoMatch</span>
          </Link>

          <nav aria-label="ניווט ראשי" className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary"
          >
            כניסה
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5 text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
                  <Receipt className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-base font-bold tracking-tight">RestoMatch</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                הזמנה, קבלת סחורה וחשבונית — מושוות אוטומטית, כדי שאף שקל לא ידלוף
                בקבלת הסחורה.
              </p>
            </div>

            <div className="flex flex-col gap-8 sm:flex-row sm:gap-16">
              <nav aria-label="קישורי תחתית" className="flex flex-col gap-2 text-sm">
                <span className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
                  ניווט
                </span>
                <Link href="/#benefits" className="text-muted hover:text-ink">
                  יתרונות
                </Link>
                <Link href="/pricing" className="text-muted hover:text-ink">
                  מחירים
                </Link>
                <Link href="/about" className="text-muted hover:text-ink">
                  אודות
                </Link>
                <Link href="/login" className="text-muted hover:text-ink">
                  כניסה למערכת
                </Link>
              </nav>

              <nav aria-label="קישורים משפטיים" className="flex flex-col gap-2 text-sm">
                <span className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
                  משפטי
                </span>
                <Link href="/privacy" className="text-muted hover:text-ink">
                  מדיניות פרטיות
                </Link>
                <Link href="/terms" className="text-muted hover:text-ink">
                  תנאי שימוש
                </Link>
                <Link href="/cookies" className="text-muted hover:text-ink">
                  מדיניות עוגיות
                </Link>
              </nav>
            </div>
          </div>

          <div className="mt-10 border-t border-line pt-6 font-mono text-xs tabular-nums text-subtle">
            © {new Date().getFullYear()} RestoMatch. כל הזכויות שמורות.
          </div>
        </div>
      </footer>
    </div>
  );
}
