import Link from 'next/link';

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen text-slate-900"
      style={{
        fontFamily: '"Heebo", system-ui, sans-serif',
        background:
          'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(37, 99, 235, 0.08), transparent 60%), linear-gradient(180deg, #FAFBFD 0%, #F4F6FA 100%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 border-b border-slate-200/60">
        <div
          className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between"
          dir="rtl"
        >
          <Link href="/showcase" className="text-lg font-bold tracking-tight flex items-baseline gap-2">
            <span className="bg-gradient-to-br from-blue-700 to-blue-500 bg-clip-text text-transparent">
              RestoMatch
            </span>
            <span className="text-slate-400 text-xs font-normal">Showcase</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <ShowcaseLink href="/showcase/receiver">Backdoor App</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard">Control Center</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard/invoices">ביקורת חשבוניות</ShowcaseLink>
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
      className="px-3 py-1.5 rounded-md text-slate-600 hover:text-blue-700 hover:bg-blue-50/60 transition-colors"
    >
      {children}
    </Link>
  );
}
