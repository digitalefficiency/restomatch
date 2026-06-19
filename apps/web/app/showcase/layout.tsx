import Link from 'next/link';

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-bg text-ink"
      style={{
        fontFamily: 'var(--font-heebo), "Heebo", system-ui, sans-serif',
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(34, 211, 154, 0.10), transparent 60%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div
          className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between"
          dir="rtl"
        >
          <Link href="/showcase" className="text-lg font-bold tracking-tight flex items-baseline gap-2">
            <span className="flow-accent bg-clip-text text-transparent">RestoMatch</span>
            <span className="text-subtle text-xs font-normal">Showcase</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <ShowcaseLink href="/showcase/receiver">Backdoor App</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard">Control Center</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard/invoices">ביקורת חשבוניות</ShowcaseLink>
            <ShowcaseLink href="/showcase/deliveries">מעקב אספקות</ShowcaseLink>
            <ShowcaseLink href="/showcase/approvals">Hierarchy Matrix</ShowcaseLink>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

function ShowcaseLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-muted hover:text-primary hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {children}
    </Link>
  );
}
