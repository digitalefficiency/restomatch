import Link from 'next/link';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export const metadata = {
  title: 'מדיניות פרטיות · RestoMatch',
  description: 'איזה מידע RestoMatch אוספת, לאילו מטרות, עם מי הוא משותף, וכיצד לממש את זכויותיכם.',
};

/**
 * Privacy policy (E.1). Hebrew/RTL skeleton covering the duty-to-inform topics
 * — controller identity, PII categories, purposes, sub-processors, cross-border
 * transfer, retention, data-subject rights, cookies, contact/DPO. Every
 * substantive sentence is tagged for legal review; no statutory citation,
 * deadline, or guarantee is asserted as fact.
 */
const SUBPROCESSORS = [
  { name: 'Supabase', purpose: 'מסד נתונים, אימות ואחסון קבצים', country: '—', dpa: 'בבדיקה' },
  { name: 'Resend', purpose: 'שליחת דוא"ל תפעולי', country: '—', dpa: 'בבדיקה' },
  { name: 'Anthropic', purpose: 'קריאת חשבוניות (OCR/AI)', country: 'ארה"ב', dpa: 'בבדיקה' },
  { name: 'Google Document AI', purpose: 'קריאת חשבוניות (OCR)', country: '—', dpa: 'בבדיקה' },
  { name: 'Upstash', purpose: 'הגבלת קצב ותורים', country: '—', dpa: 'בבדיקה' },
  { name: 'Vercel', purpose: 'אירוח אפליקציית הווב', country: '—', dpa: 'בבדיקה' },
  { name: 'Fly.io', purpose: 'אירוח שירותי רקע', country: '—', dpa: 'בבדיקה' },
  { name: 'Sentry', purpose: 'ניטור שגיאות', country: '—', dpa: 'בבדיקה' },
  { name: 'Higgsfield', purpose: 'הפקת נכסי שיווק', country: '—', dpa: 'בבדיקה' },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalShell
      title="מדיניות פרטיות"
      intro="כיצד RestoMatch אוספת, משתמשת, משתפת ושומרת מידע אישי — ואיך תוכלו לממש את זכויותיכם."
      lastUpdated="—"
    >
      <LegalSection heading="1. זהות בעל השליטה במאגר">
        <LegalClause>
          בעל השליטה במאגר המידע הוא הישות המשפטית המפעילה את RestoMatch; פרטי
          ההתאגדות, מספר העוסק וכתובת הרישום יושלמו כאן
        </LegalClause>
        <LegalClause>
          לפניות בנושא פרטיות ניתן לפנות לכתובת הקשר המפורטת בסעיף &quot;יצירת קשר
          וממונה הגנת פרטיות&quot; שבהמשך
        </LegalClause>
      </LegalSection>

      <LegalSection heading="2. קטגוריות המידע שאנו אוספים">
        <LegalClause>
          מידע חשבון: שם, כתובת דוא&quot;ד, מספר טלפון ופרטי הזדהות הדרושים לכניסה
          ולניהול ההרשאות
        </LegalClause>
        <LegalClause>
          מידע על ספקים ורכש: פרטי ספקים, הזמנות, קטלוגים ומחירים שמוזנים או נטענים
          על ידי המשתמשים
        </LegalClause>
        <LegalClause>
          תמונות וקבצים של חשבוניות ותעודות משלוח, לרבות הנתונים המופקים מהם
          בתהליך הקריאה האוטומטית
        </LegalClause>
        <LegalClause>
          מידע לידים שיווקיים שנמסר מרצון בטופס יצירת הקשר באתר
        </LegalClause>
        <LegalClause>
          מידע שימוש וטכני, כגון יומני פעולה, נתוני מכשיר ומזהים טכניים הנדרשים
          לאבטחה ולתפעול השירות
        </LegalClause>
      </LegalSection>

      <LegalSection heading="3. מטרות השימוש והבסיס החוקי">
        <LegalClause>
          אנו משתמשים במידע כדי לספק את השירות, להשוות הזמנות, קבלות וחשבוניות,
          ולהתריע על פערים
        </LegalClause>
        <LegalClause>
          אנו משתמשים במידע לצורך אבטחת מידע, מניעת הונאות, חיוב, תמיכה ושיפור
          השירות
        </LegalClause>
        <LegalClause>
          הבסיס החוקי לכל מטרה — לרבות ביצוע חוזה, הסכמה, חובה חוקית או אינטרס
          לגיטימי — יפורט וייבחן כאן
        </LegalClause>
      </LegalSection>

      <LegalSection heading="4. נותני שירות וצדדים שלישיים (Sub-processors)">
        <LegalClause>
          אנו נעזרים בנותני שירות (sub-processors) לעיבוד מידע מטעמנו; הטבלה שלהלן
          מפרטת את עיקרם ומתעדכנת במרשם נותני השירות
        </LegalClause>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">נותן שירות</th>
                <th className="px-4 py-2.5 font-medium">מטרה</th>
                <th className="px-4 py-2.5 font-medium">מדינה</th>
                <th className="px-4 py-2.5 font-medium">DPA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-2.5 text-muted">{s.purpose}</td>
                  <td className="px-4 py-2.5 text-muted">{s.country}</td>
                  <td className="px-4 py-2.5 text-subtle">{s.dpa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegalClause>
          המדינות, מנגנוני ההעברה וסטטוס הסכמי עיבוד המידע (DPA) מצוינים בטבלה
          כטיוטה ויאומתו מול המרשם הפנימי
        </LegalClause>
      </LegalSection>

      <LegalSection heading="5. העברת מידע אל מחוץ לישראל">
        <LegalClause>
          חלק מנותני השירות מעבדים מידע מחוץ לישראל, ובכלל זה ספקי קריאת חשבוניות
          שאליהם נשלחות תמונות החשבונית
        </LegalClause>
        <LegalClause>
          בסיס ההעברה אל מחוץ לישראל, לרבות ההתחייבויות החוזיות הרלוונטיות,
          מתועד בהערכת העברה ייעודית ויאומת כאן
        </LegalClause>
      </LegalSection>

      <LegalSection heading="6. תקופות שמירה (Retention)">
        <LegalClause>
          אנו שומרים מידע למשך הזמן הדרוש למטרות שלשמן נאסף, ולאחר מכן מוחקים או
          הופכים אותו לאנונימי
        </LegalClause>
        <LegalClause>
          מסמכים בעלי משמעות חשבונאית או מיסויית עשויים להישמר לתקופה ארוכה יותר
          בהתאם לדין החל, וטווחי השמירה המדויקים יפורטו כאן
        </LegalClause>
      </LegalSection>

      <LegalSection heading="7. זכויות נושא המידע">
        <LegalClause>
          לנושאי המידע עשויות לעמוד זכויות עיון, תיקון, מחיקה וניוד של המידע
          שנאסף אודותם
        </LegalClause>
        <LegalClause>
          ניתן לממש בקשות עיון, ייצוא ומחיקה דרך מסך ההגדרות במערכת, או בפנייה
          לכתובת הקשר שבהמשך
        </LegalClause>
        <p>
          לבעלי חשבון:{' '}
          <Link href="/dashboard/settings" className="text-primary underline">
            ניהול נתונים אישיים ובקשות פרטיות
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="8. עוגיות (Cookies)">
        <LegalClause>
          אנו עושים שימוש בעוגיות חיוניות הנדרשות לכניסה ולתפעול המאובטח של
          המערכת, ובעוגיות לא-חיוניות רק לאחר קבלת הסכמה
        </LegalClause>
        <p>
          פירוט מלא:{' '}
          <Link href="/cookies" className="text-primary underline">
            מדיניות העוגיות
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="9. אבטחת מידע">
        <LegalClause>
          אנו נוקטים אמצעים ארגוניים וטכניים שנועדו להגן על המידע מפני גישה,
          שימוש או גילוי בלתי-מורשים
        </LegalClause>
      </LegalSection>

      <LegalSection heading="10. יצירת קשר וממונה הגנת פרטיות">
        <LegalClause>
          שאלות, בקשות או תלונות בנושא פרטיות ניתן להפנות לכתובת הקשר וליעד
          הממונה על הגנת הפרטיות שיפורטו כאן
        </LegalClause>
      </LegalSection>
    </LegalShell>
  );
}
