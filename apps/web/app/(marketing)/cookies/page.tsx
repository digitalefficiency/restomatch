import Link from 'next/link';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export const metadata = {
  title: 'מדיניות עוגיות · RestoMatch',
  description: 'אילו עוגיות RestoMatch מציבה, לאיזו מטרה, וכיצד לנהל את ההסכמה.',
};

/**
 * Cookie policy (E.3). Discloses the strictly-necessary Auth.js session/CSRF
 * cookies (always set) and the consent cookie; analytics cookies are listed as
 * gated behind opt-in. Every substantive sentence tagged for legal review.
 */
const COOKIES = [
  {
    name: 'authjs.session-token / __Secure-authjs.session-token',
    purpose: 'שמירת מצב הכניסה (סשן מאומת)',
    category: 'חיונית',
  },
  {
    name: 'authjs.csrf-token',
    purpose: 'הגנה מפני זיוף בקשות (CSRF)',
    category: 'חיונית',
  },
  {
    name: 'rm_cookie_consent',
    purpose: 'שמירת בחירת ההסכמה לעוגיות',
    category: 'חיונית',
  },
  {
    name: 'אנליטיקה (עתידי)',
    purpose: 'מדידת שימוש ושיפור המוצר — מופעלת רק לאחר הסכמה',
    category: 'לא-חיונית',
  },
];

export default function CookiePolicyPage() {
  return (
    <LegalShell
      title="מדיניות עוגיות"
      intro="אילו עוגיות אנו מציבים, לאיזו מטרה, וכיצד תוכלו לשלוט בהסכמה."
      lastUpdated="—"
    >
      <LegalSection heading="1. מהן עוגיות">
        <LegalClause>
          עוגיות הן קבצים קטנים הנשמרים בדפדפן ומשמשים לתפעול האתר, לאבטחתו
          ולשיפור חוויית השימוש
        </LegalClause>
      </LegalSection>

      <LegalSection heading="2. סוגי העוגיות שבשימוש">
        <LegalClause>
          אנו מציבים עוגיות חיוניות הדרושות לכניסה ולתפעול מאובטח, ועוגיות
          לא-חיוניות (כגון אנליטיקה) רק לאחר קבלת הסכמה
        </LegalClause>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">עוגייה</th>
                <th className="px-4 py-2.5 font-medium">מטרה</th>
                <th className="px-4 py-2.5 font-medium">קטגוריה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COOKIES.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink">{c.name}</td>
                  <td className="px-4 py-2.5 text-muted">{c.purpose}</td>
                  <td className="px-4 py-2.5 text-subtle">{c.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection heading="3. ניהול ההסכמה">
        <LegalClause>
          ניתן לקבל או לדחות עוגיות לא-חיוניות באמצעות באנר ההסכמה, ולשנות את
          הבחירה בכל עת על ידי מחיקת עוגיית ההסכמה בדפדפן
        </LegalClause>
        <LegalClause>
          חסימת עוגיות חיוניות עלולה לפגוע ביכולת להשתמש במערכת או להישאר מחוברים
        </LegalClause>
      </LegalSection>

      <LegalSection heading="4. מידע נוסף">
        <p>
          לפרטים על המידע שאנו אוספים ראו{' '}
          <Link href="/privacy" className="text-primary underline">
            מדיניות הפרטיות
          </Link>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
