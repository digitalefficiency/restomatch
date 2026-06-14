import Link from 'next/link';
import { ArrowLeft, LayoutDashboard, PackageOpen, ShieldCheck } from 'lucide-react';

export default function ShowcaseIndex() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-20" dir="rtl">
      <div className="mb-14">
        <div className="mb-3 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold mb-3">
          Preview
        </p>
        <h1 className="text-5xl font-extrabold tracking-tight mb-3 text-ink">
          תצוגה מקדימה
        </h1>
        <p className="text-muted text-lg max-w-2xl leading-relaxed">
          שלושת המסכים המרכזיים של המערכת — מיועדים להדגמה ולסקירת חוויית משתמש לפני
          חיבור לנתונים אמיתיים.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ShowcaseCard
          href="/showcase/receiver"
          icon={<PackageOpen className="w-5 h-5" />}
          eyebrow="01 · Mobile"
          title="The Backdoor App"
          subtitle="מסך מקבל הסחורה"
          description="ערימת קלפים שניתן להחליק. אנומליות פועמות באדום. כפתור צילום חשבונית עם פולס רציף."
        />
        <ShowcaseCard
          href="/showcase/dashboard"
          icon={<LayoutDashboard className="w-5 h-5" />}
          eyebrow="02 · Web"
          title="Cinematic Control Center"
          subtitle="לוח הבעלים"
          description="KPI עם count-up. בלש דליפות עם heatmap אינטראקטיבי. Live flow timeline עם פעימות radar."
        />
        <ShowcaseCard
          href="/showcase/approvals"
          icon={<ShieldCheck className="w-5 h-5" />}
          eyebrow="03 · Governance"
          title="Decision Hierarchy"
          subtitle="מטריצת אישורים"
          description="טבלה אינטראקטיבית. כל שורה נפתחת ל-audit log אימוטבילי עם hash קריפטוגרפי."
        />
      </div>
    </main>
  );
}

function ShowcaseCard({
  href,
  icon,
  eyebrow,
  title,
  subtitle,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-6 pb-12 shadow-card hover:border-primary/40 hover:shadow-glow-primary transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
      <div className="flex items-center justify-between mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25 group-hover:bg-primary/20 transition-colors">
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-[0.15em] text-subtle font-semibold font-mono tabular-nums">
          {eyebrow}
        </span>
      </div>

      <h3 className="font-bold text-lg mb-1 tracking-tight text-ink leading-snug">
        {title}
      </h3>
      <p className="text-sm text-muted mb-3">{subtitle}</p>
      <p className="text-sm text-muted leading-relaxed">{description}</p>

      <div className="absolute bottom-5 left-6 right-6 flex items-center justify-between text-xs">
        <span className="text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          פתח תצוגה
        </span>
        <ArrowLeft className="w-4 h-4 text-subtle group-hover:text-primary group-hover:-translate-x-1 transition-all" />
      </div>
    </Link>
  );
}
