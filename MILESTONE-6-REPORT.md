# Milestone 6 — Daily Expectations + Receiver Mobile MVP

**Status:** ✅ Complete
**Duration:** ~70 minutes
**Tests added:** 17 (15 receiving + 2 E2E)
**Monorepo total:** 154 tests

## Summary

זרימת קבלת הסחורה חיה end-to-end. tRPC `receiving` router חושף 7 endpoints מלאים. Worker `daily-expectations` מחשב את ציפיות היום ושומר ל-`audit_log`. אפליקציית ה-mobile מקבלת רשימת ציפיות, מאפשרת ל-receiver לפתוח PO ולסמן שורות, ולסגור קבלה. בדיקת E2E אינטגרטיבית מאמתת את המסלול: ידני PO → start receipt → mark lines → submit → OCR (stub) → matching engine — עם תוצאת blocked על overcharge ו-clean על מסלול תקין.

## What was built

### Schema migration (`packages/db`)
- `suppliers.external_ref` (text, nullable) + `source_platform` (procurement_platform enum)
- Unique index `(source_platform, external_ref)` — prevents supplier duplicates from sync.
- Migration `0001_dry_sentinel.sql` applied to both main and test DBs.

### Sync worker (`apps/worker/src/jobs/syncPlatforms.ts`)
- Updated supplier matching to a 3-tier lookup:
  1. `(source_platform, external_ref)` — fast path for known suppliers
  2. `LOWER(name)` within restaurant — backfill for manually-created suppliers (also writes external_ref for next time)
  3. Insert new with external_ref + source_platform pre-populated

### Receiving router (`packages/api/src/routers/receiving.ts` — 315 lines)
7 procedures:
- `todayExpectations` — POs scheduled today + existing receipt status. memberProcedure.
- `getPo` — full PO detail (header + lines) for receiving screen.
- `startReceipt` — receiverProcedure. Idempotent. Creates `goods_receipts` + mirrors each PO line into `gr_lines` with qty_received=0.
- `markGrLine` — updates qty received/rejected, reject reason, condition notes (damaged/rejected enum), photos array.
- `submitReceipt` — derives status `completed` (every line met ordered qty) or `partial` (any short).
- `registerInvoice` — creates `invoices` row with status `ocr_pending`, source `photo`. Caller can then enqueue `ocr-invoice` job.
- `pendingInvoices` — lists invoices in ocr_pending/parsed state for the receiving screen.

### Daily expectations worker (`apps/worker/src/jobs/dailyExpectations.ts`)
Cron-style job (BullMQ scheduling deferred to M9 deploy). Iterates all restaurants (or a specific one), computes today's expectations via the same SQL pattern as `todayExpectations`, writes to `audit_log` with action=`daily_expectations.computed`. Push/WhatsApp notification triggers come in M8.

### Mobile screens (`apps/mobile/app/receiver/`)
- `index.tsx` — `TodayList` using tRPC `todayExpectations.useQuery`. Cards with supplier name, expected time, line count, status badge (✓ הושלם / חלקי / בתהליך / status of PO).
- `[poId].tsx` — `ReceivingScreen` using tRPC `getPo.useQuery`. Per-line cards with qty input. "Finish receiving" button calls `startReceipt` + `submitReceipt`.
- `src/trpc.tsx` — `TrpcProvider` for RN with hostUri detection for physical device testing.

Note on TypeScript: workspace-wide `@types/react@19.0.10` (pinned for Next.js) conflicts with `@types/react@~18.3.18` declared by mobile. Two strategic casts (`as unknown as React.ComponentType<...>`) in `_layout.tsx` and `trpc.tsx` work around it. Runtime is unaffected — Expo Router 4 ships React 18 compatible code. Removable when mobile upgrades to React 19 (Expo 53+).

### Test config
Set `pool: 'forks', singleFork: true` in api vitest config (was missing).
Added `--concurrency=1` to root test script so packages share the test DB safely without race conditions.

## Tests added

| Suite | Tests | What |
|---|---|---|
| `receiving.test.ts` | 15 | todayExpectations (3), startReceipt (4), markGrLine + submitReceipt (3), registerInvoice (2), getPo (2), multi-tenant isolation (1) |
| `e2e-receiving-flow.test.ts` | 2 | Full PO→GR→OCR→match flow (blocked + clean variants) |
| **M6 total** | **17** | |
| **Monorepo total** | **154** | 48 matching + 29 catalog + 24 ocr + 17 procurement + 32 api + 2 db + 2 web E2E |

## Decisions made autonomously

1. **Closed open question from M5: `suppliers.external_ref` added** with unique index on `(source_platform, external_ref)`. Sync worker now uses 3-tier lookup that backfills external_ref on first match.
2. **Daily expectations stores to `audit_log` rather than a dedicated table** — keeps the model lean. UI queries `todayExpectations` directly via tRPC; the cron is for notifications/observability.
3. **`submitReceipt` derives status from line completion** rather than asking the user. `completed` if every line ≥ ordered qty; `partial` otherwise.
4. **`markGrLine` accepts a `condition` enum** (ok/damaged/rejected) and a free-text `conditionNotes` — both feed `condition_notes` column.
5. **Mobile R18/R19 workaround via cast wrappers** — pragmatic. Bigger fix (sync versions) is M9 polish.
6. **Test concurrency = 1** — packages share the test DB; race conditions break tests. Long-term fix: per-test schemas. Quick fix: serialize at turbo level.

## Open questions

1. **Camera integration in `ScanInvoice` screen** — placeholder for now. `expo-camera` requires device-specific config; will be added when we wire to real OCR (M9 polish or pre-pilot).
2. **Push notifications on cron-detected expectations** — `audit_log` write is the signal; M8 (approvals engine) is the natural place to add WhatsApp/Push.
3. **Offline mode for mobile receiving** — schema is ready (gr_lines support partial writes), but mobile-side persistence (SQLite mirror + sync queue) is deferred to M9.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm --filter @restomatch/api test
# 32 tests pass — including the 2-test E2E that exercises receiving + OCR + matching

DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
# 6/6 packages pass, 154 total tests in ~3s

# Mobile dev (when ready):
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm start
# Opens Expo dev tools. Tap "Receiver" tab to see today's expectations.
```

## Up next — Milestone 7: Owner Dashboard (Web + Mobile)

יש לנו עכשיו זרימה מלאה. השלב הבא: דשבורד בעלים — 4 שכבות (KPIs לייב, Price Leak Detective, Supplier Scorecard, Categories). זמין גם בוובי וגם במובייל.

זמן צפוי בקצב הנוכחי: 1-2 שעות.
