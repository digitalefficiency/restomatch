import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  GitCompareArrows,
  ShieldCheck,
  Wallet,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { auth } from '@/auth';
import { MarketingShell } from './(marketing)/_components/MarketingShell';
import { RoiCalculator } from './(marketing)/_components/RoiCalculator';
import { LeadForm } from './(marketing)/_components/LeadForm';

const steps = [
  {
    icon: Camera,
    title: 'צלם את החשבונית',
    body: 'מקבל הסחורה מצלם את החשבונית בטלפון ברגע שהמשלוח מגיע. בלי הקלדה, בלי טפסים.',
  },
  {
    icon: GitCompareArrows,
    title: 'המערכת משווה להזמנה ולמשלוח',
    body: 'RestoMatch קוראת את החשבונית ומשווה אותה אוטומטית להזמנה ולסחורה שנקלטה — שורה מול שורה.',
  },
  {
    icon: ShieldCheck,
    title: 'אשרו או עצרו לפני שמשלמים',
    body: 'כל פער במחיר, בכמות או בפריט שלא הוזמן קופץ מיד. אתם מאשרים או עוצרים — לפני שהכסף יוצא.',
  },
];

const benefits = [
  {
    icon: AlertTriangle,
    title: 'תפסו דליפות לפני התשלום',
    body: 'מחירים שעלו בלי הודעה, סחורה חסרה, פריטים שלא הוזמנו — מסומנים אוטומטית במקום להיבלע בערימת חשבוניות.',
  },
  {
    icon: Wallet,
    title: 'חיסכון שמרגישים בשורה התחתונה',
    body: 'כל הפרש שנעצר הוא כסף שנשאר אצלכם. המערכת מציגה במדויק כמה חסכתם בכל חודש.',
  },
  {
    icon: Clock,
    title: 'דקות במקום שעות',
    body: 'אין יותר השוואות ידניות מול הזמנות. צילום אחד, והמערכת עושה את העבודה השחורה.',
  },
];

const proofLogos = ['מסעדה א׳', 'רשת ב׳', 'בית קפה ג׳', 'מטבח ד׳', 'בר ה׳'];

export default async function Home() {
  const session = await auth();
  // A logged-in member (has an active tenant) belongs in the app, not the
  // marketing site.
  if (session?.user?.restaurantId) {
    redirect('/dashboard');
  }

  return (
    <MarketingShell>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="glow-primary-blob pointer-events-none absolute -top-28 left-1/2 h-80 w-[44rem] -translate-x-1/2 rounded-full blur-3xl"
        />
        <div
          aria-hidden="true"
          className="glow-gold-blob pointer-events-none absolute -bottom-40 left-1/4 h-72 w-[30rem] rounded-full blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-6 h-0.5 w-14 rounded-full flow-stream" aria-hidden="true" />
            <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              הזמנה · קבלת סחורה · חשבונית
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl">
              כמה כסף דולף לך
              <br />
              <span className="bg-gradient-to-l from-gold via-primary to-primary bg-clip-text text-transparent">
                בקבלת סחורה?
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
              RestoMatch משווה כל חשבונית להזמנה ולמשלוח, ותופסת מחירים שעלו, סחורה
              חסרה ופריטים שלא הוזמנו — לפני שאתם משלמים.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#lead"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-base font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto"
              >
                התחילו עכשיו
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="#lead"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-6 py-3 text-base font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto"
              >
                דברו איתנו
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            איך זה עובד
          </h2>
          <p className="mt-3 text-base text-muted">
            שלושה צעדים — מהמשלוח שמגיע ועד החלטה לפני שמשלמים.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card"
              >
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="font-mono text-3xl font-extrabold tabular-nums text-line">
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* BENEFITS */}
      <section id="benefits" className="scroll-mt-24 border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <div className="mx-auto mb-4 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              למה מסעדות עוברות ל‑RestoMatch
            </h2>
            <p className="mt-3 text-base text-muted">
              לא עוד חשבונית שנחתמת בלי בדיקה. שליטה מלאה על מה שנכנס ומה שיוצא.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {benefits.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.title}
                  className="rounded-2xl border border-line bg-surface p-6 shadow-card"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/12 text-gold ring-1 ring-gold/25">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-bold text-ink">{b.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{b.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ROI / LEAK CALCULATOR */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_1.4fr]">
            <div className="relative overflow-hidden border-b border-line bg-surface-2 p-8 sm:p-10 lg:border-b-0 lg:border-l">
              <div
                aria-hidden="true"
                className="glow-danger-blob pointer-events-none absolute -bottom-16 -left-10 h-48 w-48 rounded-full blur-2xl"
              />
              <div className="relative">
                <div className="mb-4 h-0.5 w-10 rounded-full leak-gradient" aria-hidden="true" />
                <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  כמה אתם מפסידים היום?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  הזינו את הרכש החודשי שלכם והעריכו את אחוז הדליפה. תראו בשנייה כמה
                  כסף בורח בשנה — וכמה RestoMatch יכולה להחזיר.
                </p>
              </div>
            </div>
            <div className="p-8 sm:p-10">
              <RoiCalculator />
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF (placeholder strip) */}
      <section aria-label="לקוחות" className="border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <p className="mb-6 text-center font-mono text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
            מסעדות ורשתות שכבר עוצרות דליפות
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {proofLogos.map((logo) => (
              <span key={logo} className="text-base font-semibold text-muted/70">
                {logo}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* LEAD CAPTURE */}
      <section id="lead" className="scroll-mt-24">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <div className="mx-auto mb-8 max-w-xl text-center">
            <div className="mx-auto mb-4 h-0.5 w-10 rounded-full flow-stream" aria-hidden="true" />
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              בואו נראה כמה תחסכו
            </h2>
            <p className="mt-3 text-base text-muted">
              השאירו פרטים ונחזור אליכם לתיאום הדגמה קצרה — מותאמת למסעדה שלכם.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
            <LeadForm />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
