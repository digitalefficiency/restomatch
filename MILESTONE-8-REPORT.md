# Milestone 8 — Approvals Engine

**Status:** ✅ Complete
**Duration:** ~75 minutes
**Tests added:** 30 (17 engine + 13 router/outbox)
**Monorepo total:** 205 tests

## Summary

הלולאה נסגרה: discrepancies שנוצרות במנוע ההתאמה עוברות עכשיו דרך evaluator שמיישם את 6 הכללים מסעיף 7 של התוכנית, מתויגות ב-`requires_role`, ומופיעות בתור אישורים פר-תפקיד. בעלים/מנהל/חשב יכולים לאשר/לדחות/להסלים מהוובי או המובייל — כל החלטה נשמרת ב-`audit_log`. WhatsApp + Push notifications mocked, נכתבות ל-`notifications_outbox` עם status=`sent`.

## What was built

### Schema (`notifications_outbox`)
חדש: טבלת outbox עם enums `notification_channel` (whatsapp/push/email) ו-`notification_status` (queued/sent/failed/cancelled). אינדקסים על `(status, scheduled_at)` ו-`(related_entity_type, related_entity_id)`. Migration `0002_sturdy_puck.sql`.

### Approvals engine (`packages/api/src/approvals/engine.ts`)
Pure function `evaluateApproval(ctx, rules?)` שמיישם 7 כללים (6 מהמפרט + minor-info auto-approve):

| Priority | Rule | Trigger | Decision |
|---|---|---|---|
| 100 | duplicate-invoice | type=DUPLICATE_INVOICE | bookkeeper + block |
| 95 | large-invoice-without-po | UNORDERED_ARRIVAL + totalInvoice>5000 | owner + block |
| 90 | unordered-item-significant | UNORDERED_ITEM + delta>100 | owner + block |
| 80 | severity-block | any block severity | owner + block |
| 70 | cumulative-large | pct>5% OR total>300 | owner + queue_review |
| 60 | cumulative-medium | pct 2-5% OR total 50-300 | manager + queue_review |
| 10 | minor-info | severity=info | auto_approve |
| 0 | fallback | nothing matched | manager + queue_review |

Rules sorted by priority DESC. First match wins. Custom rules override defaults via parameter.

### Notifications (`packages/api/src/notifications/`)
- `types.ts` — `Notifier` interface, `NotificationPayload`, `NotificationSendResult`
- `outbox.ts` — `enqueueNotification` / `markSent` / `markFailed`
- `whatsapp.ts` — `MockWhatsAppNotifier` (writes to outbox + marks sent + console log)
- `push.ts` — `MockPushNotifier` (same pattern)
- `email.ts` — `EmailNotifier` (accepts optional `dispatch` callback for real Resend/Postmark; falls back to mock)

All implementations are interface-compatible with future real providers — swap the constructor.

### Approvals router (`packages/api/src/routers/approvals.ts`)
5 endpoints:
- `myQueue(limit?)` (memberProcedure) — discrepancies whose `requires_role` matches the caller's role-tier
- `approve(discrepancyId, note?)` (managerProcedure) — sets resolution=accepted + audit log entry
- `reject(discrepancyId, reason)` (managerProcedure) — sets rejected + audit log
- `escalate(discrepancyId, note?)` (managerProcedure) — moves requires_role to owner + audit log
- `history(discrepancyId)` (memberProcedure) — audit trail for a single discrepancy

Role visibility:
- Owner sees owner + manager + bookkeeper queues
- Manager sees manager only
- Bookkeeper sees bookkeeper only

### Worker integration (`apps/worker/src/jobs/matchInvoice.ts`)
End-to-end:
1. Runs `runMatch`
2. Inserts `match_run` row
3. For each discrepancy: evaluates approval rules → assigns `requires_role` → persists to `discrepancies` table (auto-approves info-level inline)
4. Updates invoice status: `disputed` if blocked, `matched` otherwise
5. For each unique role needing attention: fires WhatsApp + Push notification (mocked → outbox)
6. Logs summary

### Web (`apps/web/app/dashboard/approvals/`)
- `page.tsx` — server-rendered queue list with initial data hydration
- `list.tsx` — client component with TanStack Query mutations:
  - Per-card: severity badge, type label (Hebrew), delta amount, time
  - Actions: "אשר" (approve), "דחה" (reject with inline reason input)
  - On mutation success → invalidate queue → list refreshes
- Nav: added "תור אישורים" tab to dashboard layout

### Mobile (`apps/mobile/app/manager/index.tsx`)
- `ManagerQueue` screen with FlatList of cards
- Per-card severity, type, amount, אשר/דחה buttons
- Reject opens Modal with multi-line input
- Alert on approve success

## Tests added (30)

| Suite | Tests | What |
|---|---|---|
| `approvals-engine.test.ts` | 17 | All 7 rules + priority ordering, custom rules override, empty rules fallback |
| `approvals-router.test.ts` | 13 | myQueue role visibility (4) + approve/reject/escalate (5) + history (1) + multi-tenant (1) + role guards (1) + MockWhatsAppNotifier (1) |
| **M8 total** | **30** | |
| **Monorepo total** | **205** | matching 48 + catalog 29 + ocr 24 + procurement 17 + charts 17 + api 66 + db 2 + 2 E2E |

## Decisions made autonomously

1. **7 rules instead of 6** — added `minor-info` auto-approve (priority 10) so info-level discrepancies don't pollute queues. The remaining 6 match the spec exactly.
2. **`myQueue` uses memberProcedure (not managerProcedure)** so bookkeepers can see their own queue. Approve/reject still use `managerProcedure` + per-discrepancy role guard.
3. **Notifications dispatched per unique role**, not per discrepancy — one summary message ("3 חריגות, סה"כ ₪500") rather than spam. Reduces notification fatigue.
4. **Info-level discrepancies auto-resolved at creation** (resolution_status='accepted' set inline in the worker) — no entry to queue.
5. **`audit_log.after` carries the role of the actor** — `{ role: 'manager', note: '...' }` so reports can analyze who decided what.
6. **Worker calls `MockWhatsAppNotifier` + `MockPushNotifier`** — both write to outbox. Real provider integration is constructor-swap.
7. **`escalate` sets `requiresRole` to `owner`** — escalation is upward only. To send back down, owner approves/rejects.
8. **Reject requires a non-empty reason** (z.string().min(1)) — captures the why for analytics. Approve is no-reason-needed.

## Open questions

1. **Real WhatsApp Business onboarding** — requires Meta verification. Mock-to-real switch is `MockWhatsAppNotifier → WhatsAppCloudNotifier`. Will tackle in M9 polish when pilot starts.
2. **Notifications outbox dispatcher** — `notifications_outbox` rows are written by `MockWhatsAppNotifier.send` and marked sent immediately. For real providers, we'd add a separate worker that picks up `status=queued` rows and dispatches. M9 polish.
3. **Role-based notification routing** — currently sends to `target: "role:manager"` (a logical target). Real impl needs to enumerate users with that role + their phone/push tokens. M9 polish.
4. **JSON Logic per-restaurant overrides** — `approval_rules` table exists but the engine only uses `DEFAULT_RULES`. UI for editing custom rules + DB-driven evaluator deferred to M9.

## Demo

```bash
cd ~/Desktop/restomatch
DATABASE_URL_TEST="postgres://romkoren@localhost:5432/restomatch_test" pnpm test
# 7/7 packages, 205 tests in ~7s

# To see the live approvals queue:
cd apps/web
DATABASE_URL=... pnpm dev
# Login → /dashboard/approvals → see queue → approve/reject inline
```

## Up next — Milestone 9: Polish + Pilot Prep

הצינור ה-MVP מלא. שלב אחרון לפני פיילוט:
- Cron schedules ב-BullMQ Repeatable (daily-expectations, baselines)
- audit_log triggers על write
- Offline mode מלא במובייל (SQLite mirror)
- Sentry + PostHog
- Exports לחשב (קובץ 1000)
- Performance pass + lighthouse
- Real Document AI / Claude Vision providers (כשcredentials מגיעים)
- PILOT-CHECKLIST.md

זמן צפוי: 2-3 שעות בקצב הנוכחי.
