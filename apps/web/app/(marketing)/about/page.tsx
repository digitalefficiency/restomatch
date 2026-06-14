import Link from 'next/link';
import { Target, HeartHandshake, ScanLine } from 'lucide-react';

export const metadata = {
  title: 'אודות · RestoMatch',
  description: 'הסיפור מאחורי RestoMatch — למה בנינו מערכת שעוצרת דליפות בקבלת סחורה.',
};

const values = [
  {
    icon: Target,
    title: 'שקל אחד חשוב',
    body: 'במסעדה כל אחוז ברווחיות נלחם. בנינו כלי שמחזיר לכם את הכסף שדולף בשקט בקבלת הסחורה.',
  },
  {
    icon: ScanLine,
    title: 'פשטות לפני הכול',
    body: 'צילום אחד של חשבונית — וזהו. בלי הקלדות, בלי גיליונות, בלי תהליכים שאף אחד לא עומד בהם.',
  },
  {
    icon: HeartHandshake,
    title: 'בצד של המסעדן',
    body: 'אנחנו לא עוד תוכנה. אנחנו שותפים שרוצים שתשלמו רק על מה שבאמת הזמנתם וקיבלתם.',
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-12">
        <div className="mb-4 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          בנינו את RestoMatch כי כסף לא צריך לדלוף בשקט
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">
          בכל מסעדה עוברות עשרות חשבוניות בשבוע. מחיר שעלה בלי שאמרו, ארגז שלא
          הגיע, פריט שלא הוזמן — כל אלה נבלעים בעומס היומיומי, ובסוף החודש פשוט
          חסר כסף בקופה.
        </p>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          RestoMatch משווה אוטומטית בין מה שהזמנתם, מה שקיבלתם ומה שכתוב בחשבונית —
          ומראה לכם בדיוק איפה יש פער, עוד לפני שמשלמים. כך אתם משלמים רק על מה
          שבאמת קיבלתם.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {values.map((v) => {
          const Icon = v.icon;
          return (
            <div
              key={v.title}
              className="rounded-2xl border border-line bg-surface p-6 shadow-card"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-base font-bold text-ink">{v.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{v.body}</p>
            </div>
          );
        })}
      </div>

      <div className="relative mt-14 overflow-hidden rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
        <h2 className="text-xl font-bold tracking-tight text-ink">
          רוצים לראות כמה תחסכו?
        </h2>
        <p className="mt-2 text-sm text-muted">
          נשמח להראות לכם הדגמה קצרה, מותאמת למסעדה שלכם.
        </p>
        <Link
          href="/#lead"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          דברו איתנו
        </Link>
      </div>
    </div>
  );
}
