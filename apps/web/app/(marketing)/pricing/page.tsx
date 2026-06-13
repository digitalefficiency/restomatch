import Link from 'next/link';
import { Check, Sparkles } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';

export const metadata = {
  title: 'מחירים · RestoMatch',
  description: 'תוכניות RestoMatch — מהתנסות חינם ועד רשתות מסעדות.',
};

const featureLabels: Record<string, string> = {
  integrations: 'אינטגרציות לספקים ולהנהלת חשבונות',
  whatsapp_alerts: 'התראות בוואטסאפ',
  advanced_analytics: 'אנליטיקה מתקדמת וכרטיסי ספקים',
  accounting_export: 'ייצוא להנהלת חשבונות',
};

const planTaglines: Record<string, string> = {
  trial: 'התנסות מלאה ללא התחייבות',
  basic: 'למסעדה אחת שרוצה לעצור דליפות',
  pro: 'לעסק שרוצה שליטה ואנליטיקה מלאה',
  chain: 'לרשתות עם כמה סניפים',
};

const ils = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

function limitLabel(value: number | null, singular: string, plural: string): string {
  if (value === null) return `${plural} ללא הגבלה`;
  return `עד ${value.toLocaleString('he-IL')} ${value === 1 ? singular : plural}`;
}

export default async function PricingPage() {
  const caller = await createServerCaller();
  const plans = await caller.plans.list();

  // The "pro" tier reads as the recommended default for a single growing venue.
  const highlightKey = plans.some((p) => p.key === 'pro') ? 'pro' : plans[1]?.key;

  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-14 max-w-2xl text-center">
        <div className="mx-auto mb-4 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          תוכנית לכל מטבח
        </h1>
        <p className="mt-4 text-base text-stone-500">
          התחילו בחינם, ושדרגו כשתראו כמה כסף RestoMatch עוצרת. ללא התחייבות, ביטול בכל עת.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isHighlight = plan.key === highlightKey;
          const priceIls = plan.priceAgorotMonthly / 100;
          return (
            <div
              key={plan.key}
              className={
                'relative flex flex-col rounded-3xl p-6 ' +
                (isHighlight
                  ? 'border-2 border-primary bg-white shadow-card'
                  : 'border border-stone-200 bg-white')
              }
            >
              {isHighlight ? (
                <span className="absolute -top-3 right-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white shadow-[0_4px_12px_rgba(11,94,74,0.25)]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  הכי פופולרי
                </span>
              ) : null}

              <h2 className="text-lg font-bold text-ink">{plan.nameHe}</h2>
              <p className="mt-1 min-h-[2.5rem] text-sm text-stone-500">
                {planTaglines[plan.key] ?? ''}
              </p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-ink tabular-nums">
                  {priceIls === 0 ? 'חינם' : ils.format(priceIls)}
                </span>
                {priceIls > 0 ? (
                  <span className="text-sm text-stone-400">/ חודש</span>
                ) : null}
              </div>

              <Link
                href="/#lead"
                className={
                  'mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ' +
                  (isHighlight
                    ? 'bg-primary text-white hover:bg-primary-hover'
                    : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-ink')
                }
              >
                {plan.key === 'trial' ? 'התחילו בחינם' : 'דברו איתנו'}
              </Link>

              <ul className="mt-6 space-y-3 border-t border-stone-100 pt-6 text-sm">
                <li className="flex items-start gap-2 text-stone-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{limitLabel(plan.limits.invoicesPerMonth, 'חשבונית בחודש', 'חשבוניות בחודש')}</span>
                </li>
                <li className="flex items-start gap-2 text-stone-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{limitLabel(plan.limits.restaurants, 'מסעדה', 'מסעדות')}</span>
                </li>
                <li className="flex items-start gap-2 text-stone-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{limitLabel(plan.limits.seatsPerRestaurant, 'משתמש למסעדה', 'משתמשים למסעדה')}</span>
                </li>
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-stone-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <span>{featureLabels[feature] ?? feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-12 text-center text-sm text-stone-400">
        כל המחירים אינם כוללים מע״מ. צריכים משהו מותאם לרשת גדולה?{' '}
        <Link href="/#lead" className="font-medium text-primary hover:underline">
          דברו איתנו
        </Link>
        .
      </p>
    </div>
  );
}
