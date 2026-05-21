# Milestone 5 — Market Man Adapter + Sync Worker

**Status:** ✅ Complete
**Duration:** ~45 minutes
**Tests added:** 17 (HTTP-mocked with msw)

## Summary

Procurement Platform Hub התחיל לחיות. `MarketManAdapter` ממומש כ-class שעוטף client HTTP מובנה עם retry/backoff (5xx + 429) ו-timeout. הוא חושף 5 endpoints (listOrders, listSuppliers, listProducts, getOrder, listDeliveriesScheduled) ומחזיר את הסכמות הנורמליות שלנו (`NormalizedPurchaseOrder`, וכו'). כל הגיון ה-HTTP נבדק עם msw — 17 בדיקות מקיפות.

ה-worker `sync-platforms` מחבר את הכל ל-DB: קורא את ה-`procurement_connections`, פותח את ה-adapter, מסנכרן ספקים (lookup-or-insert by name), משדרג/יוצר `purchase_orders` עם `(source_platform, source_ref)` יחיד, ומעדכן `lastSyncAt`.

**Open question מ-M4 נסגרה: review threshold הוא כעת per-restaurant** דרך `RestaurantSettings.ocrReviewThreshold` ב-jsonb. ה-worker של ה-OCR טוען אותו ושולח ל-pipeline כ-override.

## What was built

### HTTP client (`packages/procurement/src/http.ts`)
- מבוסס fetch (Node 20+)
- Retry exponential backoff עם base delay configurable
- Retry רק על 5xx + 429
- AbortController עבור timeout
- `HttpError` class עם status, url, body
- query string builder
- מצא לבדיקות: `fetchImpl` override

### Adapter (`packages/procurement/src/adapters/marketman.ts`)
- 5 endpoints מוטמעים: orders (paginated via nextCursor), suppliers, products, getOrder, deliveries
- Authentication: `X-API-Key` header
- כל response interface מסומן `// VERIFY: pending real API contract validation`
- `normalizeOrder` ממפה את ה-payload החיצוני ל-`NormalizedPurchaseOrder`
- Pagination אוטומטי דרך nextCursor

### Sync worker (`apps/worker/src/jobs/syncPlatforms.ts`)
End-to-end:
1. טוען את ה-`procurement_connections` של המסעדה+פלטפורמה
2. בונה credentials מ-`vaultRef` (קונבנציה `env:VAR_NAME` נכון לעכשיו, Vault יבוא ב-M9)
3. קורא ל-`adapter.listSuppliers` → מיפוי `externalId → internal id` (lookup by name, insert חדשים)
4. קורא ל-`adapter.listOrders(since=lastSyncAt)` → upsert ב-`purchase_orders` עם `sourcePlatform/sourceRef` כ-unique key
5. שורות PO מוחלפות פר-PO (המקור הוא authoritative)
6. עדכון `lastSyncAt`

### Per-restaurant OCR review threshold
- הוסף `ocrReviewThreshold?: number` ל-`RestaurantSettings`
- ה-worker של ה-OCR קורא את ה-settings של המסעדה ומעביר את ה-threshold ל-`runOcrPipeline`
- Fallback לברירת המחדל הגלובלית (0.85) אם לא הוגדר

## Tests added (17)

| תרחיש | מספר |
|---|---|
| listOrders happy + pagination + empty | 3 |
| Retry: 500 retries, 429 retries, persistent 500 fails | 3 |
| No retry: 401, 400 | 2 |
| Currency default to ILS | 1 |
| getOrder happy + URL-encoding special chars | 2 |
| listSuppliers + listProducts + listDeliveriesScheduled | 3 |
| Auth: missing apiKey, empty apiKey | 2 |
| Line normalization fallback (description → productName) | 1 |
| **סה"כ M5** | **17** |
| **מאגר סה"כ** | **137** (48 matching + 29 catalog + 24 ocr + 17 procurement + 15 API + 2 DB + 2 E2E) |

## Decisions made autonomously

1. **HTTP client ללא תלות חיצונית** — fetch + AbortController מספיקים. אין undici/axios. פחות bundle, פחות vulnerabilities.
2. **Retry on 5xx + 429 בלבד** — 4xx (client error) לא ראוי לרטרי, ייכשל מיד.
3. **MSW במקום nock** — MSW 2.x עובד עם fetch של Node 20, יותר נקי לבדיקות.
4. **`credentialsVaultRef` בקונבנציה `env:VAR_NAME` לעת עתה** — Vault integration מלא יבוא ב-M9. עד אז, ה-key מאוחסן ב-env var.
5. **שמירת supplier matching by name (lowercase)** — אין עדיין `external_ref` ב-suppliers. סומן VERIFY ל-M5.1 migration. עד שיוסיפו — שינויי שם של ספק יוצרים כפילויות. סביר באולם המייצב.
6. **PO upsert by `(source_platform, source_ref)`** — כבר יש unique index, אז ה-PO לעולם לא ישוכפל לאותו external order. שורות מוחלפות full על כל sync.
7. **`platform` נורמליזציה ל-`restomatch` בשאלות email/manual** — ה-DB enum לא כולל אותן, ה-types כן. אם מגיע מ-email/manual fallback (לא צפוי דרך adapter), אנחנו מסמנים כ-restomatch.

## Open questions

1. **suppliers.external_ref column** — נוסיף ב-migration קטן בתחילת M6, אחרת sync חוזר יוצר ספק כפול אם השם שלהם שונה ב-fitness case.
2. **Webhook handler** — `handleWebhook?` ב-interface, לא מומש כי MarketMan webhooks דורשים registration. נדחה ל-M5.1 כש-credentials זמינים.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm --filter @restomatch/procurement test
# 17 tests, ~450ms
```

עם API key אמיתי (בעתיד):
```bash
export DATABASE_URL=postgres://romkoren@localhost:5432/restomatch
export MARKETMAN_API_KEY=<real-key>
# Add a procurement_connections row pointing to env:MARKETMAN_API_KEY
# Enqueue a sync-platforms job → worker pulls orders → stores POs
```

## Up next — Milestone 6: Daily Expectations + Receiver Mobile MVP

יש לנו עכשיו פלטפורמת רכש שמפיקה POs. השלב הבא: לקחת את ה-POs היומיים, להציג ב-mobile למקבל סחורה, ולסגור את הלולאה עד OCR.

צפי בקצב הנוכחי: 1-2 שעות.
