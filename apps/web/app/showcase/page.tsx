import Link from 'next/link';
import { ArrowLeft, LayoutDashboard, PackageOpen, ShieldCheck } from 'lucide-react';

export default function ShowcaseIndex() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-20" dir="rtl">
      <div className="mb-14">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-600 font-semibold mb-3">
          Preview
        </p>
        <h1 className="text-5xl font-bold tracking-tight mb-3 text-stone-900">
          תצוגה מקדימה
        </h1>
        <p className="text-stone-500 text-lg max-w-2xl leading-relaxed">
          שלושת המסכים המרכזיים של המערכת — מיועדים להדגמה ולסקירת חוויית משתמש לפני
          חיבור לנתונים אמיתיים.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
      className="group relative rounded-2xl border border-stone-200/70 bg-white/80 backdrop-blur-xl p-6 pb-12 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-teal-300/70 hover:shadow-[0_2px_4px_rgba(37,99,235,0.06),0_12px_32px_-8px_rgba(37,99,235,0.12)] hover:-transtone-y-0.5 transition-all duration-300"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-teal-50 text-teal-600 border border-teal-100 group-hover:bg-teal-100 group-hover:border-teal-200 transition-colors">
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-[0.15em] text-stone-400 font-semibold tabular-nums">
          {eyebrow}
        </span>
      </div>

      <h3 className="font-semibold text-lg mb-1 tracking-tight text-stone-900 leading-snug">
        {title}
      </h3>
      <p className="text-sm text-stone-500 mb-3">{subtitle}</p>
      <p className="text-sm text-stone-600 leading-relaxed">{description}</p>

      <div className="absolute bottom-5 left-6 right-6 flex items-center justify-between text-xs">
        <span className="text-teal-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          פתח תצוגה
        </span>
        <ArrowLeft className="w-4 h-4 text-stone-300 group-hover:text-teal-600 group-hover:-transtone-x-1 transition-all" />
      </div>
    </Link>
  );
}
