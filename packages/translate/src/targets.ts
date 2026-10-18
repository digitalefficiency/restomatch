/**
 * Receiver languages (wave 1, flag `receiverLanguages`): Arabic, Russian, Thai,
 * Tigrinya — the foreign workers who receive deliveries in Israeli kitchens.
 *
 * TargetGlossary is the offline, deterministic first leg for these languages:
 * a curated dictionary of the most common restaurant-supply items, keyed by the
 * Hebrew name (normalized with matchKey, like the English glossary). A name it
 * doesn't know is left to Claude (TargetTranslator) and, offline, falls back to
 * the English rendering in the UI. Trailing sizes / pack counts ("4 ל׳",
 * "(שישייה)") are split off, translated by the English glossary/unit map and
 * re-attached, so "אקונומיקה 4 ל׳" reuses the "אקונומיקה" entry.
 *
 * Tigrinya entries are kept to everyday food words; see the S14 report for the
 * ones flagged for a native review.
 */
import { matchKey } from './normalize';

export const TARGET_LOCALES = ['ar', 'ru', 'th', 'ti'] as const;
export type TargetLocale = (typeof TARGET_LOCALES)[number];

export function isTargetLocale(value: unknown): value is TargetLocale {
  return typeof value === 'string' && (TARGET_LOCALES as readonly string[]).includes(value);
}

/** English name of each target language (used in the Claude prompt). */
export const TARGET_LANGUAGE_NAMES: Record<TargetLocale, string> = {
  ar: 'Arabic (Modern Standard, simple words)',
  ru: 'Russian',
  th: 'Thai',
  ti: "Tigrinya (Ge'ez script, Eritrean usage)",
};

type Row = readonly [he: string, ar: string, ru: string, th: string, ti: string | null];

/** [Hebrew, Arabic, Russian, Thai, Tigrinya|null] */
const ROWS: readonly Row[] = [
  // Produce
  ['עגבניות', 'طماطم', 'Помидоры', 'มะเขือเทศ', 'ኮሚደረ'],
  ['עגבניה', 'طماطم', 'Помидор', 'มะเขือเทศ', 'ኮሚደረ'],
  ['עגבניות שרי', 'طماطم كرزية', 'Помидоры черри', 'มะเขือเทศเชอร์รี่', 'ንኣሽቱ ኮሚደረ (ቸሪ)'],
  ['מלפפונים', 'خيار', 'Огурцы', 'แตงกวา', null],
  ['מלפפון', 'خيار', 'Огурец', 'แตงกวา', null],
  ['בצל', 'بصل', 'Лук', 'หอมใหญ่', 'ቀይሕ ሽጉርቲ'],
  ['בצל יבש', 'بصل', 'Лук репчатый', 'หอมใหญ่', 'ቀይሕ ሽጉርቲ'],
  ['שום', 'ثوم', 'Чеснок', 'กระเทียม', 'ጻዕዳ ሽጉርቲ'],
  ['שום קלוף', 'ثوم مقشر', 'Чеснок очищенный', 'กระเทียมปอกเปลือก', 'ዝተቐልጸ ጻዕዳ ሽጉርቲ'],
  ['תפוחי אדמה', 'بطاطا', 'Картофель', 'มันฝรั่ง', 'ድንሽ'],
  ['תפוח אדמה', 'بطاطا', 'Картофель', 'มันฝรั่ง', 'ድንሽ'],
  ['גזר', 'جزر', 'Морковь', 'แครอท', 'ካሮት'],
  ['חצילים', 'باذنجان', 'Баклажаны', 'มะเขือม่วง', 'ባደንጃን'],
  ['חציל', 'باذنجان', 'Баклажан', 'มะเขือม่วง', 'ባደንጃን'],
  ['פלפל אדום', 'فلفل أحمر حلو', 'Красный болгарский перец', 'พริกหวานสีแดง', 'ቀይሕ በርበረ ዘይመርር'],
  ['פלפל ירוק', 'فلفل أخضر', 'Зелёный перец', 'พริกหวานสีเขียว', null],
  ['חסה', 'خس', 'Салат латук', 'ผักกาดหอม', 'ሰላጣ'],
  ['חסה ערבית', 'خس روماني', 'Салат романо', 'ผักกาดคอส', 'ሰላጣ'],
  ['לימונים', 'ليمون', 'Лимоны', 'มะนาวเหลือง', 'ሎሚ'],
  ['לימון', 'ليمون', 'Лимон', 'มะนาวเหลือง', 'ሎሚ'],
  ['פטרוזיליה', 'بقدونس', 'Петрушка', 'พาร์สลีย์', 'ፐርሰሞሎ'],
  ['כוסברה', 'كزبرة', 'Кинза', 'ผักชี', 'ቆጽሊ ድምብላል'],
  ['נענע', 'نعناع', 'Мята', 'สะระแหน่', 'ናዕናዕ'],
  ['פטריות', 'فطر', 'Грибы', 'เห็ด', 'ፉንጊ (ሙሽሩም)'],
  ['תפוזים', 'برتقال', 'Апельсины', 'ส้ม', 'ኣራንሺ'],
  // Protein
  ['חזה עוף', 'صدر دجاج', 'Куриная грудка', 'อกไก่', 'ኣፍልቢ ደርሆ'],
  ['פרגית', 'فخذ دجاج بدون عظم', 'Куриное бедро без кости', 'สะโพกไก่ไม่มีกระดูก', 'ስጋ ሰለፍ ደርሆ ብዘይ ዓጽሚ'],
  ['כנפיים', 'أجنحة دجاج', 'Куриные крылья', 'ปีกไก่', 'ኣኽናፍ ደርሆ'],
  ['עוף שלם', 'دجاج كامل', 'Целая курица', 'ไก่ทั้งตัว', 'ምሉእ ደርሆ'],
  ['בשר טחון', 'لحم مفروم', 'Мясной фарш', 'เนื้อบด', 'ዝተጠሓነ ስጋ'],
  ['אנטריקוט', 'أنتريكوت (ريب آي)', 'Антрекот (рибай)', 'เนื้อริบอาย', 'ስጋ ኣንትሪኮት'],
  ['כתף טלה', 'كتف خروف', 'Баранья лопатка', 'ไหล่แกะ', 'መንኩብ በጊዕ'],
  ['נקניקיות מרגז', 'نقانق مرقاز', 'Колбаски мергез', 'ไส้กรอกเมอร์เกซ', null],
  ['פילה סלמון', 'فيليه سلمون', 'Филе лосося', 'เนื้อปลาแซลมอน', 'ስጋ ዓሳ ሳልሞን'],
  ['סלמון', 'سلمون', 'Лосось', 'ปลาแซลมอน', 'ዓሳ ሳልሞን'],
  ['דניס שלם', 'دنيس كامل', 'Дорадо целая', 'ปลาซีบรีม (ดอราโด) ทั้งตัว', 'ምሉእ ዓሳ (ደኒስ)'],
  ['דניס', 'دنيس', 'Дорадо', 'ปลาซีบรีม (ดอราโด)', 'ዓሳ (ደኒስ)'],
  ['טונה אדומה', 'تونة حمراء', 'Красный тунец', 'ปลาทูน่าแดง', 'ቀይሕ ቱና'],
  ['קלמרי', 'كاليماري (حبار)', 'Кальмар', 'ปลาหมึก', 'ካላማሪ'],
  ['ביצים', 'بيض', 'Яйца', 'ไข่', 'እንቋቑሖ'],
  // Dairy
  ['חלב', 'حليب', 'Молоко', 'นม', 'ጸባ'],
  ['חלב 3%', 'حليب 3%', 'Молоко 3%', 'นม 3%', 'ጸባ 3%'],
  ['חמאה', 'زبدة', 'Сливочное масло', 'เนย', 'ቡሮ'],
  ['גבינה בולגרית', 'جبنة بلغارية', 'Болгарская брынза', 'ชีสบัลแกเรีย', 'ቡልጋርያዊ ፎርማጆ'],
  ['מוצרלה', 'موزاريلا', 'Моцарелла', 'มอสซาเรลล่า', 'ሞዛረላ'],
  ['לבנה', 'لبنة', 'Лабане', 'ลาบเนห์', 'ላብነ'],
  ['שמנת מתוקה', 'كريمة خفق', 'Сливки', 'วิปปิ้งครีม', 'ክሬማ'],
  ['שמנת מתוקה 38%', 'كريمة خفق 38%', 'Сливки 38%', 'วิปปิ้งครีม 38%', 'ክሬማ 38%'],
  ['יוגורט', 'لبن زبادي', 'Йогурт', 'โยเกิร์ต', 'ርጉእ (ዮጉርት)'],
  // Bakery
  ['פיתות', 'خبز عربي (بيتا)', 'Пита', 'ขนมปังพิต้า', 'ባኒ ፒታ'],
  ['פיתה', 'خبز عربي (بيتا)', 'Пита', 'ขนมปังพิต้า', 'ባኒ ፒታ'],
  ['חלה', 'خبز حلة', 'Хала', 'ขนมปังฮาลา', 'ባኒ ሓላ'],
  ['באגט', 'باغيت', 'Багет', 'ขนมปังบาแก็ต', 'ባኒ ባጌት'],
  ['לחם', 'خبز', 'Хлеб', 'ขนมปัง', 'ባኒ'],
  ['לחם מחמצת', 'خبز العجين المخمر', 'Хлеб на закваске', 'ขนมปังซาวร์โดว์', null],
  ['לחמניות המבורגר', 'خبز برغر', 'Булочки для бургеров', 'ขนมปังเบอร์เกอร์', 'ባኒ በርገር'],
  // Pantry
  ['קמח', 'طحين', 'Мука', 'แป้ง', 'ሓርጭ'],
  ['קמח לבן', 'طحين أبيض', 'Мука пшеничная', 'แป้งสาลีขาว', 'ጻዕዳ ሓርጭ'],
  ['סוכר', 'سكر', 'Сахар', 'น้ำตาล', 'ሽኮር'],
  ['סוכר לבן', 'سكر أبيض', 'Сахар белый', 'น้ำตาลทรายขาว', 'ጻዕዳ ሽኮር'],
  ['מלח', 'ملح', 'Соль', 'เกลือ', 'ጨው'],
  ['מלח ים גס', 'ملح بحري خشن', 'Соль морская крупная', 'เกลือทะเลเม็ดหยาบ', 'ዓቢ ጨው ባሕሪ'],
  ['אורז', 'أرز', 'Рис', 'ข้าวสาร', 'ሩዝ'],
  ['אורז יסמין', 'أرز ياسمين', 'Рис жасмин', 'ข้าวหอมมะลิ', 'ሩዝ ጃስሚን'],
  ['בורגול גס', 'برغل خشن', 'Булгур крупный', 'ข้าวสาลีบัลกูร์หยาบ', 'ዓቢ ቡርጉል'],
  ['חומוס יבש', 'حمص يابس', 'Нут сухой', 'ถั่วลูกไก่แห้ง', 'ደረቕ ሽምብራ'],
  ['טחינה גולמית', 'طحينة خام', 'Тхина (кунжутная паста)', 'งาบดทาฮินี', 'ጣሒና'],
  ['שמן זית', 'زيت زيتون', 'Оливковое масло', 'น้ำมันมะกอก', 'ዘይቲ ኣውሊዕ'],
  ['שמן זית כתית מעולה', 'زيت زيتون بكر ممتاز', 'Оливковое масло Extra Virgin', 'น้ำมันมะกอกเอ็กซ์ตร้าเวอร์จิ้น', 'ዘይቲ ኣውሊዕ'],
  ['שמן קנולה', 'زيت كانولا', 'Масло рапсовое', 'น้ำมันคาโนล่า', 'ዘይቲ ካኖላ'],
  ['כמון טחון', 'كمون مطحون', 'Кумин молотый', 'ยี่หร่าป่น', 'ዝተጠሓነ ከሙን'],
  ['פפריקה מתוקה', 'بابريكا حلوة', 'Паприка сладкая', 'ปาปริก้าหวาน', 'ፓፕሪካ'],
  ['פלפל שחור גרוס', 'فلفل أسود مجروش', 'Перец чёрный дроблёный', 'พริกไทยดำบดหยาบ', 'ጸሊም በርበረ'],
  ['סומק', 'سماق', 'Сумах', 'ซูแมค', 'ሱማቅ'],
  // Beverages
  ['מיץ תפוזים סחוט', 'عصير برتقال طازج', 'Апельсиновый сок свежевыжатый', 'น้ำส้มคั้นสด', 'ጽማቝ ኣራንሺ'],
  ['מים מינרליים', 'مياه معدنية', 'Минеральная вода', 'น้ำแร่', 'ማይ'],
  ['יין אדום קברנה', 'نبيذ أحمر كابيرنيه', 'Красное вино Каберне', 'ไวน์แดงคาเบอร์เนต์', null],
  ['בירה מהחבית', 'بيرة من البرميل', 'Разливное пиво', 'เบียร์สด', 'ቢራ'],
  ['קולה זירו', 'كولا زيرو', 'Кола Зеро', 'โคล่าซีโร่', 'ኮላ ዜሮ'],
  // Supplies
  ['אקונומיקה', 'مبيض (كلور)', 'Отбеливатель', 'น้ำยาฟอกขาว', 'ክሎሪን'],
  ['נוזל כלים', 'سائل جلي', 'Средство для мытья посуды', 'น้ำยาล้างจาน', 'ሳሙና ሳሕኒ'],
  ['כפפות ניטריל', 'قفازات نيتريل', 'Нитриловые перчатки', 'ถุงมือไนไตรล์', 'ጓንቲ'],
  ['מפיות נייר', 'مناديل ورقية', 'Бумажные салфетки', 'กระดาษเช็ดปาก', 'ሶፍት'],
  ['קופסאות טייק-אוויי', 'علب سفري', 'Контейнеры на вынос', 'กล่องใส่อาหารกลับบ้าน', 'ሳንዱቕ ምግቢ'],
];

/** Hebrew size/pack tokens we split off the end of a name and re-attach. */
const TRAILING = /\s*(\([^()]*\)|\d+(?:[.,]\d+)?\s*%?|\d+(?:[.,]\d+)?\s*[א-ת״"׳'.]{0,5}|[א-ת]{1,3}[״"׳'])\s*$/;

/** Hebrew pack words inside a trailing "(…)" → neutral rendering. */
function renderSuffix(raw: string): string | null {
  const s = raw.trim();
  // Pure numbers / percents are universal.
  if (/^\d+(?:[.,]\d+)?\s*%?$/.test(s)) return s;
  return null;
}

export class TargetGlossary {
  private readonly map = new Map<string, Row>();

  constructor(rows: readonly Row[] = ROWS) {
    for (const r of rows) this.map.set(matchKey(r[0]), r);
  }

  get size(): number {
    return this.map.size;
  }

  private lookup(he: string, locale: TargetLocale): string | null {
    const row = this.map.get(matchKey(he));
    if (!row) return null;
    const idx = TARGET_LOCALES.indexOf(locale) + 1;
    return (row[idx] as string | null) ?? null;
  }

  /**
   * Translate one Hebrew name, or null. `suffixRenderer` turns a split-off
   * trailing size/pack token into display text (the API passes the English
   * glossary + unit map, e.g. "4 ל׳" → "4 L"); without it only bare numbers /
   * percentages are re-attached.
   */
  translate(
    he: string,
    locale: TargetLocale,
    suffixRenderer: (suffix: string) => string | null = renderSuffix,
  ): string | null {
    const text = he.trim();
    if (!text) return null;
    const whole = this.lookup(text, locale);
    if (whole) return whole;
    // Peel up to 3 trailing size / pack tokens.
    let core = text;
    const suffixes: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = TRAILING.exec(core);
      if (!m || m.index === 0) break;
      suffixes.unshift(m[1]!);
      core = core.slice(0, m.index).replace(/[\s—–-]+$/, '');
      const hit = this.lookup(core, locale);
      if (hit) {
        const rendered = suffixes.map((s) => suffixRenderer(s));
        if (rendered.some((r) => r == null)) return null;
        return `${hit} ${rendered.join(' ')}`.trim();
      }
    }
    return null;
  }
}

let shared: TargetGlossary | null = null;
export function defaultTargetGlossary(): TargetGlossary {
  shared ??= new TargetGlossary();
  return shared;
}
