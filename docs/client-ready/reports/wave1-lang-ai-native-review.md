# S14 — receiver languages: changes and native-speaker review lists

Second review pass (meaning against he/en + fit on 390 px phone buttons), one reviewer per language. Each file below lists what changed and what a native speaker should confirm. **Tigrinya needs a native Eritrean speaker before real use.**

---

## Arabic (ar) receiver overlay review

Scope: apps/web/lib/i18n/messages/receiverLangs/overlays/ar/*.ts (receiving, scans, nav, components, receiverLangs, auth login/checkEmail/twoFactor).
Checked against he.ts (source) and en.ts. tsc: clean for overlays/ar. receiver-langs.test.ts: 28/28 passed.

Terms used throughout: invoice = فاتورة, order = طلبية, supplier = مورد, delivery = توصيلة/توصيلات (delivery notes = إشعارات التسليم), discrepancy = فرق/فروق.

## 1. Changes made (11)

| Key | Old | New | Reason |
|---|---|---|---|
| nav.links.receiving | استلام البضاعة | الاستلام | Nav label was 1.55x the English "Receiving"; the screen title (receiving.inbox.title) still says استلام البضاعة |
| receiving.inbox.noDeliveryDate | بدون تاريخ تسليم | بدون تاريخ توصيل | Same delivery word as توصيلات (emptyTitle, backToList, backToInbox) |
| receiving.inbox.emptyDescription | …سجّل أي فروق لحفظ التوفير. | …سجّل أي فروق لتثبيت التوفير. | "حفظ التوفير" ("save the saving") sounds odd; "lock in" = تثبيت |
| receiving.steps.recon.potentialLossHint | …وحفظ التوفير. | …وتثبيت التوفير. | Same as above, kept consistent |
| receiving.steps.supplier.subtitle | سنفتح طلبية الشراء الخاصة به… | سنفتح طلبيته… | One term for order (طلبية); shorter and plainer |
| components.activity.matchesOrder | مطابقة لطلبية الشراء ولاستلام البضاعة | مطابقة للطلبية ولاستلام البضاعة | One term for order |
| components.activity.matchesOrderAndReceipt | مطابقة لطلبية الشراء ولاستلام البضاعة | مطابقة للطلبية ولاستلام البضاعة | One term for order; same Hebrew source as matchesOrder |
| receiving.steps.scan.retake | صوّر من جديد | أعد التصوير | Standard, shorter button wording |
| receiving.steps.recon.retake | صوّر الفاتورة من جديد | أعد تصوير الفاتورة | Matches scan.retake wording |
| receiving.errors.queueUnavailable | …تابع الاستلام مقابل الطلبية. | …تابع الاستلام حسب الطلبية. | Unreviewed key. Meaning was correct; wording now matches errors.ocrTimeout ("حسب الطلبية") |
| auth.twoFactor.subtitle | المكون | المكوّن | Added the shadda to remove ambiguity |

Unreviewed keys I checked and kept: nav.links.chain = السلسلة (restaurant chain), nav.links.branches = الفروع. Both are correct and short.

## 2. Native-speaker review list (14)

| Key | Text | Why unsure |
|---|---|---|
| receiving.steps.scan.retake | أعد التصوير | 11 chars against 6 for "Retake" (over 1.3x). I found no shorter clear option; check that it fits the 390 px button |
| receiving.* "delivery" | توصيلة / توصيلات | Is توصيلة natural for workers in Israel, or is شحنة / بضاعة / إرسالية better? |
| components.activity.awaitingDeliveryNotes / awaitingMonthlyMatch | إشعارات التسليم | Is إشعار تسليم the term workers use for תעודת משלוח? Alternatives: سند تسليم, ورقة التوصيل |
| nav.links.leaks | كاشف الخسائر | "Leak detective" is rendered as "loss detector". Clear, but it drops the "leak" image. Alternative: كاشف التسريبات |
| components.activity.discrepancies, receiving *.items, fixRemaining, adjust.subtitle, matchedSummary | {count} فروق / أصناف / أسطر | Arabic plurals change with the number (3–10 vs 11+ vs 1–2), and one template string can't get this right for every count |
| nav.worker.lastBeat | آخر إشارة قبل {minutes} دقيقة. | Should be دقائق for 3–10. Also, is "إشارة" clear for heartbeat? |
| receiving.inbox.badge.completed / steps.confirmed.title | تم إغلاق الاستلام | 17 chars against 14. الاستلام مغلق would be shorter |
| receiving.steps.recon.title | نتيجة المطابقة | The Hebrew means "cross-check result". Check that مطابقة doesn't read as "it matched" |
| receiving.steps.recon.subtitle | دقة القراءة {confidence} | "OCR confidence" is rendered as "reading accuracy". Plain, but not literal |
| receiving.steps.recon.unordered vs status.unordered | لم يُطلب / ليس في الطلبية | Two wordings for "Not ordered", following the two different Hebrew strings. Should they be one? |
| receiving.steps.recon.call | اتصال | Noun; the imperative اتصل may read better as a button |
| receiving.steps.adjust.settled | تم الفحص | The Hebrew סודר means "sorted out", the English means "Checked". I followed the English |
| components.activity.inclVat | {amount} شامل الضريبة | Short for "incl. VAT". Workers may expect شامل ض.ق.م or شامل المعمعم (Israeli usage) |
| components.entitlement.features.integrations | الربط مع أنظمة أخرى | Longer than "Integrations", but it is used inside sentences, not on a button. Alternative: التكاملات |

---

## Russian (ru) receiver overlay review

Scope: `apps/web/lib/i18n/messages/receiverLangs/overlays/ru/*.ts`. Every string was checked against the Hebrew source (he.ts), with en.ts as a secondary reference.
Verification: `tsc` reports no errors in overlays/ru, and `receiver-langs.test.ts` passes 28/28. No Hebrew characters were found. Nothing was committed.

Terms used across all files:
- invoice = накладная
- order = заказ
- supplier = поставщик
- receipt/receiving = приёмка
- delivery/shipment = поставка
- discrepancy = расхождение
- delivery notes (תעודות משלוח) = документы поставок. This avoids a clash with накладная, which now means only the invoice.

## 1. Changes (17)

| Key | Old → New | Reason |
|---|---|---|
| receiving.steps.scan.backToSupplier | Назад к выбору поставщика → Назад к поставщику | Length (25 → 18 characters; English is 16) |
| receiving.steps.adjust.tapToExpand | Нажмите, чтобы раскрыть → Развернуть | Length; the standard UI verb |
| receiving.steps.adjust.asOrdered | = как в заказе ({qty}) → = заказ ({qty}) | Length; matches the Hebrew "= הזמנה" and English "= order" |
| receiving.steps.adjust.asInvoiced | = как в накладной ({qty}) → = накладная ({qty}) | Length; matches Hebrew and English |
| receiving.steps.adjust.damaged | Повреждено → Брак | Length (10 vs 7 in English); the usual kitchen/warehouse word |
| receiving.steps.adjust.fixRemaining | Проверить ещё строк: {count} → Осталось проверить: {count} | The old wording was unnatural |
| receiving.steps.recon.quickConfirm | Всё в порядке — быстро подтвердить → Всё верно — подтвердить | Length (34 → 22; English is 24) |
| receiving.steps.recon.agentChanged | …данные агента поставщика → …данные представителя поставщика | In Russian "агент" sounds odd; "представитель" is the natural word for a supplier's sales rep |
| receiving.demo.banner | Демо — пример данных… → Демо — тестовые данные… | More natural wording |
| components.entitlement.title | Повысьте тариф, чтобы открыть: {feature} → Перейдите на платный тариф, чтобы открыть: {feature} | "Повысьте тариф" sounds unnatural; now uses the same wording as compactTitle |
| components.entitlement.body | {feature} — доступно на платных тарифах. Повысьте тариф… → Функция «{feature}» доступна на платных тарифах. Смените тариф… | Feature names have different genders and numbers (аналитика, экспорт, уведомления), so "доступно" would not agree. Wrapping the name in «Функция …» fixes that. |
| components.entitlement.compactCta | Посмотреть тарифы → К тарифам | Length (17 vs 9 in English) |
| components.entitlement.cta | Посмотреть тарифы и перейти → Выбрать тариф | "и перейти" was left without an object; also shorter |
| components.activity.consolidatedReceivedNumbered | Получен сводный счёт {number} → Получена сводная накладная {number} | Consistency: invoice = накладная |
| components.activity.awaitingDeliveryNotes | …с накладными за эту неделю → …с документами поставок за эту неделю | Delivery notes were also called "накладные", which clashed with the invoice term |
| components.activity.awaitingMonthlyMatch | …с накладными за этот месяц → …с документами поставок за этот месяц | Same reason as above |
| auth.login.invitedHint | …войдите под ним… → …войдите с ним… | "войти под адресом" is unidiomatic |

The three keys added without review were checked and kept: nav.links.chain "Сеть", nav.links.branches "Филиалы" and receiving.errors.queueUnavailable. All three are accurate and natural.

## 2. Native-speaker review list

| Key | Text | Why unsure |
|---|---|---|
| components.activity.consolidatedReceivedNumbered | Получена сводная накладная {number} | A חשבונית ריכוז is really a monthly tax invoice, so "сводный счёт" is more accurate. I chose накладная for consistency. Please confirm which term owners and receivers expect. |
| components.activity.awaitingDeliveryNotes / awaitingMonthlyMatch | …с документами поставок… | Needs a term for delivery notes that differs from накладная (invoice). The alternative "товарные накладные" would clash again. |
| receiving.steps.adjust.damaged | Брак | Natural and short, but "брак" also covers defects, not only damage. The alternative is "Повреждено" (longer). |
| receiving.steps.adjust.tapToExpand | Развернуть | Drops "нажмите". This is fine if it sits on a visible disclosure control. |
| nav.groups.operations | Работа | Vague. "Операции" could be misread as financial transactions. Alternative: "Текущая работа". |
| nav.links.branches | Филиалы | Correct, but in everyday speech a chain's locations are often called "точки" or "рестораны". |
| receiving.steps.recon.potentialLoss / components.activity.potentialLoss | Возможная потеря… | "Возможные потери" (plural) may sound more natural for money. |
| receiving.steps.scan.process | Обработать накладную | 20 characters vs 15 in English, slightly over 1.3×. Kept for clarity. Shorter option: "Обработать". |
| auth.twoFactor.submit | Подтвердить | 11 characters vs 6 in English, but it is the natural verb and probably a full-width button. |
| checkEmail.devHint | Режим разработки — смотрите в логе сервера в разделе | "в разделе" for "under <key>" is a guess. Dev-only text. |
| auth.login.invitedHint | …войдите с ним… | An alternative is "войдите с этим адресом" or "войдите, указав его". |
| receiving.steps.adjust.asOrdered / asInvoiced | = заказ ({qty}) / = накладная ({qty}) | These are terse. Confirm they still read as "same as order/invoice" on the chip. |
| receiving.steps.confirmed.savings | Зафиксированная возможная экономия | Bureaucratic. Alternative: "Возможная экономия (записано)". |

---

## Thai (th) receiver overlay review

Files: `apps/web/lib/i18n/messages/receiverLangs/overlays/th/*.ts`
Verification: `tsc --noEmit | grep overlays/th` printed nothing; `receiver-langs.test.ts` passed 28/28. Nothing committed.

## Term decisions
- **invoice → บิล** (was ใบแจ้งหนี้). Kitchen and delivery staff call the paper that comes with the goods "บิล". ใบแจ้งหนี้ is formal and office-style, and it is long on buttons. I replaced all 34 occurrences across components, nav, receiverLangs, receiving and scans. "ใบแจ้งหนี้รวม" became "บิลรวม" (consolidated invoice).
- **supplier → ผู้จำหน่าย** (kept). It was already used everywhere and any literate Thai reader understands it. ซัพพลายเออร์ is hotel/office jargon that rural workers may not know. This choice is on the review list.
- Kept as is: ใบสั่งซื้อ (order/PO), ใบส่งของ (delivery note), รับสินค้า (receiving).

## 1. Changes (key: old → new, reason)

1. **All files, every invoice string**: ใบแจ้งหนี้ → บิล. Shorter and the everyday word (34 occurrences).
2. auth `login.magicSubmit`: ส่งลิงก์เข้าสู่ระบบทางอีเมล → ส่งลิงก์เข้าสู่ระบบ. Shorter button; the email is already implied.
3. components `errors.notFound`: ไม่พบ — อาจถูกลบไปแล้ว → ไม่พบรายการนี้ — อาจถูกลบไปแล้ว. "ไม่พบ" alone has no object and reads as broken.
4. components `activity.types.invoice_matched`: ใบแจ้งหนี้ตรงกัน → ตรวจเทียบบิลแล้ว. The Hebrew means "was matched/reconciled", not "matches". Now consistent with `invoiceMatchedNumbered`.
5. components `activity.matchesOrderAndReceipt`: ตรงกับใบสั่งซื้อและของที่มาส่ง → ตรงกับใบสั่งซื้อและการรับสินค้า. Same Hebrew as `matchesOrder`, so it now uses the same Thai.
6. components `activity.awaitingDeliveryNotes`: รอตรวจกับใบส่งของประจำสัปดาห์นี้ → รอเทียบกับใบส่งของสัปดาห์นี้. "ประจำ" was stiff, and เทียบ (compare) is closer to the source. Calm tone kept.
7. components `activity.awaitingMonthlyMatch`: รอตรวจกับใบส่งของประจำเดือนนี้ → รอเทียบกับใบส่งของเดือนนี้. Same reason.
8. nav `groups.admin`: ผู้ดูแล → การจัดการ. ניהול means "management" (a section). ผู้ดูแล means "a caretaker person".
9. nav `search.hint`: ลูกศรเพื่อเลื่อน · Enter เพื่อเปิด · Esc เพื่อปิด → ใช้ลูกศรเลื่อน · Enter เปิด · Esc ปิด. The repeated "เพื่อ" was translationese.
10. nav `worker.body`: …ถูกบันทึกไว้แล้ว และจะถูกอ่านและตรวจทันทีที่ระบบกลับมา → บิลที่อัปโหลดจะถูกบันทึกไว้ และระบบจะอ่านและตรวจทันทีที่กลับมาใช้งานได้. The Hebrew is future tense ("invoices you upload will be saved"), and the stacked passives read badly.
11. receiving `inbox.emptyDescription`: …เพื่อเก็บเงินที่ประหยัดได้ → …เพื่อบันทึกเงินที่ประหยัดได้. "เก็บเงิน" reads as "collect cash". The meaning is to record or lock in the savings.
12. receiving `inbox.badge.completed`: รับสินค้าเสร็จแล้ว → รับเสร็จแล้ว. Shorter badge.
13. receiving `steps.scan.subtitle`: จาก "{supplier}" ต้องเห็นทุกรายการชัดเจน → จาก "{supplier}" ถ่ายให้เห็นทุกรายการชัดเจน. Clearer instruction ("shoot so every line is visible").
14. receiving `steps.scan.capture`: ถ่ายรูป / อัปโหลดไฟล์ → ถ่ายรูป / อัปโหลด. Shorter button.
15. receiving `steps.recon.potentialLossHint`: ไปที่หน้าจำนวน เพื่อบันทึกของที่มาส่งจริงและเก็บเงินที่ประหยัดได้ → ไปตรวจจำนวน เพื่อบันทึกของที่มาจริงและบันทึกเงินที่ประหยัดได้. Matches the button, and avoids the "collect cash" reading.
16. receiving `steps.recon.continueAdjust`: ไปที่หน้าจำนวน → ไปตรวจจำนวน. It is an action ("go check the quantities"), not "go to the quantity page".
17. receiving `steps.adjust.closeAndSave`: ปิดการรับสินค้าและบันทึก → ปิดและบันทึก. The long primary button risked wrapping at 390 px. The screen title already gives the context.
18. receiving `errors.queueUnavailable` (unreviewed key): …ระบบอ่านอัตโนมัติใช้งานไม่ได้ — รับสินค้าต่อโดยตรวจกับใบสั่งซื้อ → บันทึกบิลแล้ว แต่ตอนนี้ระบบอ่านบิลอัตโนมัติยังใช้ไม่ได้ — รับสินค้าต่อโดยเทียบกับใบสั่งซื้อ. "ยัง…ไม่ได้" is calmer ("not yet"), says what is being read, and "เทียบกับ" means "against the order".

I checked the other two unreviewed keys and kept them: `nav.links.chain` = เครือร้าน and `nav.links.branches` = สาขา.

## 2. Native-speaker review list

| Key | Text | Why unsure |
|---|---|---|
| (term) invoice | บิล (everywhere) | บิล is the everyday word for the delivery paper. But some Israeli suppliers hand over a delivery note and a tax invoice separately, so a native should confirm บิล is not read as "receipt/payment slip". |
| (term) supplier | ผู้จำหน่าย (everywhere) | Correct but formal. Workers may actually say "ซัพ/ซัพพลายเออร์", "เจ้า…" or "ร้านที่มาส่ง". Needs a native call; if changed, change all ~10 uses. |
| nav.links.chain | เครือร้าน | Unreviewed key. "Restaurant chain" is fine, but plain "เครือ" or "เครือข่ายร้าน" may suit a nav label better. |
| nav.links.leaks | ตามหาเงินรั่ว | "Leak detective". The "money leaking" metaphor may not land. "นักสืบเงินรั่ว" or "เงินที่หายไป" are alternatives. |
| receiving.inbox.emptyDescription / recon.potentialLossHint | …บันทึกเงินที่ประหยัดได้ | "Lock in the savings" has no natural Thai equivalent. Check this reads naturally and is not confusing. |
| receiving.steps.adjust.closeAndSave | ปิดและบันทึก | Short, but drops "receipt". Confirm it is clear in context. |
| receiving.steps.recon.subtitle | บิล {number} · ความมั่นใจในการอ่าน {confidence} | OCR "confidence" is a technical concept. A simpler phrase may work better, e.g. "อ่านได้แม่นยำ {confidence}". |
| receiving.steps.confirmed.another | รับสินค้ารายการใหม่ | "รายการ" also means "line item", so a reader may take it as "receive a new item" rather than "a new delivery". |
| receiving.steps.adjust.damaged | เสียหาย | Workers may say "ของเสีย" or "เสีย". The current chip is fine but formal. |
| receiving.steps.recon.agentChanged | ⚠️ ข้อมูลพนักงานขายของผู้จำหน่ายเปลี่ยนไป | Long. Thai trade speech often uses "เซลล์" for a sales rep. |
| receiving.steps.supplier.expectedOnePo / expectedPos | มีใบสั่งซื้อ 1 ใบ / มีใบสั่งซื้อ {count} ใบ | Loses the "expected" nuance. Could be "รอส่ง…". |
| receiving.inbox.continueReceipt | รับสินค้าที่ค้างไว้ต่อ | Natural, but on the long side for a button. |
| nav.worker.lastBeat | ติดต่อได้ครั้งล่าสุด {minutes} นาทีที่แล้ว | "Heartbeat" is rendered loosely as "last contact". Confirm the meaning is clear. |
| components.breadcrumbs.label | เส้นทางหน้า | Screen-reader label only. Unusual wording; might be better as "ตำแหน่งหน้า". |
| auth.checkEmail.devHint | โหมดพัฒนา — ดูในบันทึกของเซิร์ฟเวอร์ที่ | Developer-only string. Phrasing ending in "ที่" before a code value is awkward. |
| receiverLangs.picker.hint | ภาษาสำหรับผู้รับสินค้า: อาหรับ รัสเซีย ไทย ติกรินยา … | Check the spelling of "ติกรินยา" (Tigrinya). |
| nav.groups.admin | การจัดการ | Changed from ผู้ดูแล. Confirm against how other Thai apps label the admin section. |

---

## Tigrinya (ti) overlay review

Scope: `apps/web/lib/i18n/messages/receiverLangs/overlays/ti/*.ts`. Each string was checked against Hebrew (`<ns>/he.ts`, the source of truth) and English (`en.ts`). Verification: `tsc` prints nothing for overlays/ti, and `receiver-langs.test.ts` passes 28/28. Nothing is committed.

## 1. Changes made (7)

| Key | Old | New | Reason |
|---|---|---|---|
| receiving.steps.scan.retake | ደጊምኩም ስእሊ ኣልዕሉ | ስእሊ ድገሙ | (d) Length. 15 chars against EN "Retake" (6). It is still a polite plural imperative ("repeat the photo"). |
| receiving.steps.recon.retake | ደጊምኩም ስእሊ ፋቱራ ኣልዕሉ | ስእሊ ፋቱራ ድገሙ | (d)/(e) Shorter, and now uses the same verb as scan.retake. |
| receiving.steps.adjust.damaged | ዝተበላሸወ | ዝተጎድአ | (b) በላሸ is an Amharic loan. ተጎድአ / ጉድኣት is the common Tigrinya word for damage. |
| receiving.errors.queueUnavailable | ፋቱራ ተዓቂባ ኣላ … ሕጂ የለን … | ፋቱራ ተዓቂቡ ኣሎ … ሕጂ ኣይሰርሕን ዘሎ … | (e) ፋቱራ had feminine agreement here but masculine everywhere else (በጺሑ, ተሰማሚዑ, ይንበብ). (a) "not available / not working now" is closer to HE לא זמינה כרגע than "doesn't exist now". Also matches nav.worker.title. |
| nav.worker.title | ናይ ምስራሕ ሲስተም ሕጂ ኣይሰርሕን ዘሎ። | ናይ መስርሕ ሲስተም ሕጂ ኣይሰርሕን ዘሎ። | (a) HE מנוע העיבוד means "processing engine". ምስራሕ reads as "working/doing". መስርሕ = processing, and matches processing.eyebrow. |
| components.errors.validation | ገለ ቦታታት ጌጋ እዮም። … | ገለ ዝመላእኩምዎ ሓበሬታ ጌጋ እዩ። … | (a) ቦታታት means physical places, not form fields. The new text says "some information you filled in is wrong". |
| components.toast.dismiss | መልእኽቲ ኣርሕቑ | መልእኽቲ ዕጸዉ | (e)/(a) HE סגירת הודעה means "close message". This now uses ዕጸዉ, the same verb as nav.menu.close. |

Checked and kept (the strings added without review):
- **nav.links.chain ሰንሰለት**: kept. It is the literal word for "chain" and is understood as a calque of "restaurant chain". There may be no better short word. Flagged as P1.
- **nav.links.branches ጨናፍር**: kept. This is the correct Tigrinya broken plural of ጨንፈር ("branch", as in ጨንፈር ባንኪ). Flagged as P1.
- **receiving.errors.queueUnavailable**: fixed (see the table above).

Register: every imperative is already in the polite plural (…ኡ/…ዉ forms, ደጊምኩም ፈትኑ, በጃኹም …). None needed changing.

## 2. Native-speaker review list

### P1: what the receiver sees on every delivery (wizard buttons, statuses, nav)

| Key | Text | Why confirm |
|---|---|---|
| receiving.steps.scan.retake | ስእሊ ድገሙ | New wording. Is "ስእሊ ድገሙ" natural for "retake the photo", or would ደጊምኩም ኣልዕሉ be preferred even though it is longer? |
| receiving.steps.recon.retake | ስእሊ ፋቱራ ድገሙ | New wording. Same question. |
| receiving.steps.adjust.damaged | ዝተጎድአ | New wording. Is it the right word for spoiled or damaged goods? Other options: ዝተሰብረ (broken), ዝበላሸወ (colloquial). |
| receiving.steps.adjust.missing | ጎደሎ | Chip. ጎደሎ is shared with Amharic. Would ዝጎደለ or ዘይመጸ ("didn't arrive") be clearer to a receiver? |
| receiving.steps.scan.process | ፋቱራ ስደዱ | HE means "process the invoice", but this says "send the invoice". The capture button next to it also uses ስደዱ (ፋይል ስደዱ). Could the two be confused? |
| receiving.steps.scan.capture | ስእሊ ኣልዕሉ / ፋይል ስደዱ | Is ኣልዕሉ the everyday verb for taking a photo in Eritrea, or is ሳእሉ / ስኣሉ more common? |
| receiving.steps.adjust.asOrdered | = ትእዛዝ ({qty}) | Chip. Is ትእዛዝ understood as a purchase order, or do kitchens say ኦርደር? |
| receiving.steps.adjust.asInvoiced | = ፋቱራ ({qty}) | Chip. Is ፋቱራ (from Italian) the everyday Eritrean word for "invoice"? |
| receiving.steps.adjust.settled | ተፈቲሹ | Status. HE סודר means "sorted out" and EN says "Checked". Is "checked" right here? |
| receiving.steps.adjust.closeAndSave | ምቕባል ዕጸዉ እሞ ዓቕቡ | Main button, 16 chars. Natural? Does it fit on one line? |
| receiving.steps.adjust.fixRemaining | ካልእ {count} መስመራት ፈትሹ | Button. Natural? |
| receiving.steps.adjust.qtyLabel | ዝተቐበልኩምዎ ብዝሒ | Label. Natural? |
| receiving.steps.recon.quickConfirm | ኩሉ ጽቡቕ እዩ — ቀልጢፍኩም ኣረጋግጹ | Button, 25 chars, close to the length limit. |
| receiving.steps.recon.continueAdjust | ናብ ብዝሒ ቀጽሉ | Is "continue to quantity" clear? |
| receiving.steps.recon.matched / status.matched | ይሰማማዕ | Status badge. Matches or agrees? |
| receiving.steps.recon.different | ይፈላለ | Status badge. |
| receiving.steps.recon.unordered / status.unordered | ዘይተኣዘዘ | Status badge. |
| receiving.steps.recon.missing / status.missing_from_invoice | ኣብ ፋቱራ ዘየለ | Status badge. |
| receiving.steps.status.qty_diff | ብዝሒ ይፈላለ | Status badge. |
| receiving.steps.status.price_diff | ዋጋ ይፈላለ | Status badge. |
| receiving.inbox.badge.pending | ምቕባል ይቕጽል ኣሎ | Badge. Natural for "receipt in progress"? |
| receiving.inbox.badge.partial | ብኸፊል ተቐቢሉ | Badge. |
| receiving.inbox.badge.completed / confirmed.title | ምቕባል ተዓጽዩ | Badge and title. Can "receipt closed" be said this way? |
| receiving.inbox.continueReceipt | ዝተኸፍተ ምቕባል ቀጽሉ | Button. |
| receiving.inbox.openReceipt | ሓድሽ ምቕባል ጀምሩ | Button. |
| receiving.inbox.receiveGoods | ኣቕሓ ተቐበሉ | Button. |
| receiving.steps.supplier.continue | ናብ ስእሊ ፋቱራ ቀጽሉ | Button. |
| receiving.steps.supplier.title | ኣየናይ ኣቕራቢ እዩ መጺኡ? | Is ኣቕራቢ the everyday word for "supplier" in kitchens? |
| receiving.steps.scan.back / backToSupplier | ንድሕሪት / ናብ ኣቕራቢ ተመለሱ | Buttons. |
| receiving.steps.scan.frameHint | ፋቱራ ኣብ ውሽጢ እቲ ሳጹን ኣእትዉ | Is ሳጹን ("box") the right word for the camera frame? |
| receiving.steps.processing.title | ፋቱራ ይንበብ ኣሎ… | Masculine agreement for ፋቱራ. Is that correct Eritrean usage? (I made all strings masculine.) |
| receiving.steps.processing.done / running / waiting | ተወዲኡ / ይሰርሕ ኣሎ… / ይጽበ ኣሎ | Step status labels. |
| receiving.steps.confirmed.another | ካልእ ምቕባል | Button. |
| receiving.steps.confirmed.viewScan | ስእሊ ርኣዩ | Button. |
| receiving.steps.confirmed.backToInbox / po.backToList | ናብ ኣቕርቦታት ተመለሱ | Is ኣቕርቦታት right for "deliveries"? |
| receiving.steps.recon.call | ደውሉ | Button. |
| receiving.errors.queueUnavailable | ፋቱራ ተዓቂቡ ኣሎ፡ ግን ኣውቶማቲክ ንባብ ሕጂ ኣይሰርሕን ዘሎ — … | Changed. This is shown on delivery when OCR is down. |
| receiving.loading / nav.loading / components.spinner.loading | ይጽዓን ኣሎ | Is ጽዓነ ("load") natural for software loading? |
| nav.links.receiving | ምቕባል ኣቕሓ | Nav item. |
| nav.links.chain | ሰንሰለት | Added without review. Is "chain" understood as a restaurant chain? Another option is መርበብ ("network"). |
| nav.links.branches | ጨናፍር | Added without review. Confirm the plural. |
| nav.links.overview | ሓፈሻዊ ትርኢት | 9 chars against EN 8. Is it natural? |
| nav.links.exports | ምውጻእ ፋይላት | 9 chars against EN 7, at the limit. |
| nav.links.leaks | መርማሪ ክሳራ | Is "Leak detective" conveyed? |
| nav.links.approvals | ምጽዳቕ | Nav item. |
| nav.links.settings | ቅጥዕታት | Is this the common word for app settings? |
| nav.links.suppliers / orders / team / catalog | ኣቕረብቲ / ትእዛዛት / ጉጅለ / ካታሎግ | Nav items. |
| nav.signOut | ካብ ኣካውንት ውጹ | 11 chars against EN 8, slightly over 1.3×. Could plain ውጹ work? |
| nav.menu.open / close / more | ሜኑ ክፈቱ / ሜኑ ዕጸዉ / ተወሳኺ | Menu labels. |
| nav.worker.title | ናይ መስርሕ ሲስተም ሕጂ ኣይሰርሕን ዘሎ። | Changed. This banner is visible during receiving. |
| receiverLangs.picker.title / label | ቋንቋ ኣፕሊኬሽን ምረጹ / ቋንቋ | The language picker that every receiver sees. |
| receiverLangs.lines.machine | ትርጉም ማሽን — ምስ ፋቱራ ኣነጻጽሩ | Shown on every translated line. |
| receiverLangs.lines.original / untranslated | ብመበቆሉ / ትርጉም የለን — ብመበቆል ቋንቋ ይርአ | Line hints. |
| auth.login.submit / twoFactor.submit | እተዉ / ኣረጋግጹ | Login buttons. |

### P2: everything else

| Key | Text | Why confirm |
|---|---|---|
| components.errors.validation | ገለ ዝመላእኩምዎ ሓበሬታ ጌጋ እዩ። … | Changed wording. |
| components.toast.dismiss | መልእኽቲ ዕጸዉ | Changed wording. |
| components.errors.network | ናብ ሰርቨር ክበጽሕ ኣይከኣለን … | The subject of the verb is implicit. Natural? |
| components.errors.notFound | ኣይተረኽበን — ተደምሲሱ ክኸውን ይኽእል። | Is ተደምሲሱ ("deleted") natural? |
| components.loadMore.label | ተወሳኺ ኣርእዩ | HE says "load more", EN "Load more". This says "show more". |
| components.breadcrumbs.label | መንገዲ ገጽ | Screen-reader text only. |
| components.entitlement.* | ፓኬጃት / ኣመሓይሹ … | Is ፓኬጅ right for a subscription plan? Is ኣመሓይሹ right for "upgrade"? |
| components.entitlement.features.integrations | ምትእስሳር ምስ ካልእ ሲስተም | Long. Natural? |
| components.activity.types.alias_learned | ሓድሽ ስም ኣቕሓ ተማሂሩ | The subject (the system) is implicit. |
| components.activity.types.sync_completed | ምትእስሳር ሓበሬታ ተዛዚሙ | Is this a good word for "sync"? |
| components.activity.types.discrepancy_approved / rejected | ፍልልይ ጸዲቑ / ተነጺጉ | Is ፍልልይ right for "discrepancy"? |
| components.activity.awaitingDeliveryNotes / awaitingMonthlyMatch | … ወረቐት ኣቕርቦት … | Is ወረቐት ኣቕርቦት the term for "delivery note"? |
| components.activity.consolidatedReceivedNumbered | ሓባራዊ ፋቱራ {number} በጺሑ | Is ሓባራዊ ፋቱራ right for a consolidated invoice (חשבונית ריכוז)? |
| components.activity.inclVat | {amount} ምስ ቫት | VAT term. |
| components.activity.savings / potentialLoss | {amount} ተቘጢቡ / ክመጽእ ዝኽእል ክሳራ {amount} | Money phrasing. |
| receiving.inbox.subtitle / emptyDescription | … ቁጠባ ንምሕላው … | Is ቁጠባ ንምሕላው right for "lock in the savings"? |
| receiving.inbox.receiveFrom | ካብ {supplier} ተቐበሉ | |
| receiving.steps.supplier.subtitle | … ነምጽኦ … ነነጻጽሮ | First-person plural "we". Natural? |
| receiving.steps.supplier.expectedOnePo / expectedPos | 1 ትእዛዝ ይጽበ ኣሎ / {count} ትእዛዛት ይጽበዩ ኣለዉ | Agreement. |
| receiving.steps.scan.subtitle | ካብ "{supplier}"። ኩሉ መስመር ኣቕሓ ብንጹር ከም ዝርአ ኣረጋግጹ። | |
| receiving.steps.scan.useDemo / bannerDemo / demo.banner | ናይ ፈተነ … | Is ፈተነ right for "demo"? |
| receiving.steps.scan.uploadFailed / errors.upload | ምልኣኽ (ስእሊ) ኣይሰለጠን: {message} | |
| receiving.steps.processing.subtitle / subtitleLive | … ነንብብ … ነነጻጽሮ … | |
| receiving.steps.processing.catalog / compare / translate / ocr | … ምንጽጻር / ምትርጓም / ምንባብ | Verbal-noun step names. |
| receiving.steps.recon.title | ውጽኢት ምርመራ | Is "check result" conveyed? |
| receiving.steps.recon.subtitle | ፋቱራ {number} · ርግጽነት ንባብ {confidence} | Is "OCR confidence" conveyed by ርግጽነት ንባብ? |
| receiving.steps.recon.potentialLoss / potentialLossHint | ካብ ፍልልያት ክመጽእ ዝኽእል ክሳራ: / … | |
| receiving.steps.recon.agentChanged / phoneChanged | ሓበሬታ ወኪል ኣቕራቢ ተቐይሩ / … ካልኣይ ተዓቂቡ | Is ወኪል right for a sales agent? |
| receiving.steps.recon.verifyWhatsapp | ብWhatsApp ምስዚ ኣረጋግጹ: | |
| receiving.steps.recon.colSku / colDelta / colStatus | ኮድ ኣቕሓ / ፍልልይ ₪ / ኩነታት | Table headers. |
| receiving.steps.adjust.title | ብሓቂ ክንደይ መጺኡ? | |
| receiving.steps.adjust.subtitle | {pending} መስመራት ገና ክፍተሹ ኣለዎም · … | Long. |
| receiving.steps.adjust.matchedSummary | {count} ዝሰማምዑ መስመራት — ብኣውቶማቲክ ጸዲቖም | |
| receiving.steps.adjust.tapToExpand / decrease / increase | ንምዝርጋሕ ጠውቑ / ብዝሒ ኣጉድሉ / ብዝሒ ወስኹ | Accessibility labels. |
| receiving.steps.adjust.saving | ምቕባል ይዕቀብ ኣሎ… | |
| receiving.steps.confirmed.subtitle | … ናይ ምንጽጻር ሲስተም ናይ መወዳእታ ምርመራ የካይድ ኣሎ። | |
| receiving.steps.confirmed.verifiedValue / savings / scanSaved | … | |
| receiving.english.* | መበቆል ብእብራይስጢ ኣርእዩ … | Is እብራይስጢ the word for Hebrew? |
| receiving.unnamedItem / unorderedItem | ስም ዘይብሉ ኣቕሓ / ኣብ ትእዛዝ ዘየለ ኣቕሓ | |
| receiving.errors.ocrTimeout | … ካብ ልሙድ ንላዕሊ ይጸንሕ ኣሎ … | |
| receiving.errors.notFound / forbidden | መዝገብ ኣይተረኽበን። / ፍቓድ የብልኩምን። | |
| nav.search.* | ድለዩ… / ይድለ ኣሎ… / ውጽኢት የለን / እንተወሓደ 2 ፊደላት ጽሓፉ | Is the passive ይድለ ኣሎ right? Is ፊደላት right for "characters"? |
| nav.search.hint | ቀስትታት ንምንቅስቓስ · Enter ንምኽፋት · Esc ንምዕጻው | |
| nav.worker.body / lastBeat / ownerNotified | … መወዳእታ ምልክት ቅድሚ {minutes} ደቒቕ። … | Is ምልክት right for "heartbeat"? |
| nav.groups.operations / purchasing / admin | ዕለታዊ ስራሕ / ዕድጊ / ምምሕዳር | |
| nav.mainLabel / mobileLabel / skipToContent | ቀንዲ መዘዋወሪ / ቅልጡፍ መዘዋወሪ / ናብ ትሕዝቶ ሕለፉ | Screen-reader text. |
| nav.links.ask | ሕተቱ RestoMatch | Word order. |
| receiverLangs.picker.hint | … ዓረብኛ፡ ሩስኛ፡ ታይኛ፡ ትግርኛ … | Is ታይኛ the name for Thai? |
| scans.* | ዝተሳእለ ፋቱራ / ውሑስ ሊንክ / ኣብ ሓድሽ ታብ ክፈቱ / ፖፕ-ኣፕ ዝዓግት … | Is ዝተሳእለ right for "scanned"? Check the loanwords. |
| scans.localCopy | ኣብ ኮምፒዩተር ዘሎ ቅዳሕ (ንምምዕባል) | Developer-only text. |
| auth.login.* | ናብ RestoMatch እተዉ / መሕለፊ ቃል / ሊንክ … | Is መሕለፊ ቃል the usual word for "password"? Is ሊንክ fine? |
| auth.login.rememberMe | ኣብዚ መሳርሒ ዘክሩኒ | |
| auth.login.invitedHint / sent / resetDone / signedOut | … | |
| auth.login.errors.* | … | |
| auth.checkEmail.* | ኢመይልኩም ርኣዩ / … ን24 ሰዓት ይሰርሕ / ናብ ምእታው ተመለሱ | |
| auth.twoFactor.* | ብኽልተ ስጉምቲ ምርግጋጽ / … ኮድ ምምላስ … | Is ኮድ ምምላስ right for "recovery code"? |
