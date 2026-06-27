import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export const metadata = {
  title: 'תנאי שימוש · RestoMatch',
  description: 'התנאים החוזיים לשימוש בשירות RestoMatch.',
};

/**
 * Terms of service (E.2). Hebrew/RTL skeleton — service description, account
 * responsibility, billing, IP, liability framing, governing law. Every clause
 * tagged for legal review; no warranty, SLA figure, or jurisdiction is asserted
 * as binding fact.
 */
export default function TermsPage() {
  return (
    <LegalShell
      title="תנאי שימוש"
      intro="התנאים החלים על השימוש ב-RestoMatch. השימוש בשירות מהווה הסכמה לתנאים אלה."
      lastUpdated="—"
    >
      <LegalSection heading="1. תיאור השירות">
        <LegalClause>
          RestoMatch מספקת כלי להשוואת הזמנות, קבלות סחורה וחשבוניות עבור מסעדות
          ולזיהוי פערים בתהליך הרכש
        </LegalClause>
        <LegalClause>
          אנו רשאים לעדכן, להרחיב או לשנות את תכולת השירות מעת לעת, בכפוף לדין החל
        </LegalClause>
      </LegalSection>

      <LegalSection heading="2. החשבון והאחריות עליו">
        <LegalClause>
          המשתמש אחראי לשמירת סודיות פרטי הכניסה ולכל פעולה המתבצעת תחת חשבונו
        </LegalClause>
        <LegalClause>
          המשתמש מתחייב למסור מידע נכון ועדכני ולהשתמש בשירות בהתאם לדין ולתנאים
          אלה
        </LegalClause>
      </LegalSection>

      <LegalSection heading="3. שימוש מותר ואסור">
        <LegalClause>
          אין לעשות בשירות שימוש לרעה, לרבות ניסיון לעקוף בקרות אבטחה, להעמיס על
          המערכת או לפגוע במשתמשים אחרים
        </LegalClause>
        <LegalClause>
          אין להעלות תוכן בלתי-חוקי או תוכן שאין למשתמש זכות להעלותו
        </LegalClause>
      </LegalSection>

      <LegalSection heading="4. תשלומים וחיוב">
        <LegalClause>
          תנאי החיוב, המסלולים והמחירים מפורטים בעמוד המחירים ועשויים להתעדכן
          בכפוף להודעה מוקדמת כנדרש בדין
        </LegalClause>
      </LegalSection>

      <LegalSection heading="5. קניין רוחני">
        <LegalClause>
          זכויות הקניין הרוחני בשירות, בקוד ובעיצוב שמורות לבעליהן; המשתמש נותר
          הבעלים של הנתונים שהוא מזין
        </LegalClause>
      </LegalSection>

      <LegalSection heading="6. הגבלת אחריות">
        <LegalClause>
          השירות ניתן כפי שהוא; היקף האחריות, החריגים והסעדים יוגדרו כאן בכפוף
          להוראות הדין שאינן ניתנות להתניה
        </LegalClause>
      </LegalSection>

      <LegalSection heading="7. סיום ההתקשרות">
        <LegalClause>
          כל צד רשאי לסיים את ההתקשרות בהתאם לתנאים שיפורטו כאן; עם הסיום יחולו
          הוראות שמירת המידע והמחיקה הרלוונטיות
        </LegalClause>
      </LegalSection>

      <LegalSection heading="8. דין חל וסמכות שיפוט">
        <LegalClause>
          על תנאים אלה יחול הדין הישראלי, וסמכות השיפוט תיקבע כאן בכפוף לבדיקה
          משפטית
        </LegalClause>
      </LegalSection>

      <LegalSection heading="9. שינויים בתנאים">
        <LegalClause>
          אנו רשאים לעדכן תנאים אלה מעת לעת; המשך השימוש לאחר עדכון מהווה הסכמה
          לנוסח המעודכן, בכפוף לדין
        </LegalClause>
      </LegalSection>
    </LegalShell>
  );
}
