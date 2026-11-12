# int-04 — Claims, letters and recovery (₪ back)

Scope: how a discrepancy becomes a supplier claim → credit-request letter → "sent" → credit note → money back, plus overdue chasing and the supplier ledger. Code read on `release/train-a` (scratchpad `trainA`, HEAD `c6132c0e`). All paths below are relative to that checkout. `main` (`759fb554`) has the same files. `lib/claims.ts` is shorter there (57 lines against 91), because the owner's 31.10 never-claimable list and the 7-day constant only exist on train-a.

Roles that touch this area: **owner** and **manager** decide, send and record. **Bookkeeper** can open every recovery procedure (`financeProcedure` = owner/manager/bookkeeper, `packages/api/src/trpc.ts:162`). **Chef** and **receiver** are locked out of the recovery router. Note that the receiver can read the supplier ledger, which carries ₪ (see §6).

---

## 1. Data model and lifecycle (the spine)

| Table | Purpose | Defined |
|---|---|---|
| `recovery_claims` | One row per accepted discrepancy: `amount_agorot`, `credited_agorot`, `status`, stamps `letter_sent_at / acknowledged_at / credited_at / recovered_at / closed_at`, `last_reminder_at` | `packages/db/src/schema.ts:2142-2177` |
| `recovery_events` | Append-only history (from→to, amount, actor; a NULL actor means system) | `schema.ts:2179-2206` |
| `credit_notes` | A supplier credit note: manual entry or `invoice_line`. Unique per (supplier, number), per invoice line, per idempotency key | `schema.ts:2103-2140` |
| `suppliers.contact_email / contact_whatsapp` | Supplier contacts. **The claims flow never uses them** (§3) | `schema.ts:433-434` |

Lifecycle (`packages/api/src/recovery/lifecycle.ts:144-163`):
`claimed → letter_sent → acknowledged → credited → recovered`, plus the side states `disputed` and `written_off`. A claim can only enter `credited` through `recordCreditNote`, never by a status flip (`lifecycle.ts:152-153`, enforced at `recovery/service.ts:593-595`). `allocateCredit` splits a note over the selected claims oldest-first, in integer agorot (`lifecycle.ts:209-226`).

Shared rules (`packages/api/src/lib/claims.ts`):
- Claimable statuses are `open/escalated/accepted` (`claims.ts:13`). Never claimable: `PRICE_LOWER`, `UNORDERED_ARRIVAL`, `MISSING_ON_INVOICE` (`claims.ts:22`, owner 31.10).
- `CLAIM_ANSWER_DAYS = 7` (`claims.ts:34`). Overdue means **more than** 7 whole Israel calendar days since the letter, or since the claim when no letter was sent (`claims.ts:36-48`). Server side: `overdueSql` (`recovery/service.ts:70-73`). Web side: `ANSWER_DAYS = 7` (`apps/web/app/dashboard/recovery/logic.ts:145`).
- VAT basis per type: `DUPLICATE_INVOICE` is incl. VAT, `VAT_MISMATCH` is a VAT amount, everything else is excl. VAT (`claims.ts:56-63`). The per-invoice cap applies (`claims.ts:73-86`).

None of these files is on the immutable list. The **₪ math they consume** is: `packages/matching/src/engine.ts` (delta amounts, severities), `schema.ts`, and the migrations. Any change to the claim tables or columns is a human PR.

---

## 2. Workflow A — Discrepancy → claim (materialisation)

**Who:** the decider (owner or manager, by approval routing) clicks "approve" on a discrepancy.

1. `approvals.approve` sets `resolution_status='accepted'` and writes audit and activity rows (`packages/api/src/routers/approvals.ts:376-420`). Nothing in this procedure creates a claim.
2. The claim is created **lazily** by `syncClaims` (`recovery/service.ts:130-288`). It runs only when one of these happens:
   - someone opens `/dashboard/recovery` or `/dashboard/leaks/claims`. Those pages call `recovery.summary` / `recovery.list`, which call `syncClaims` (`routers/recovery.ts:49-50, 70-71`);
   - the daily `recovery-reminders` job runs (`recovery/reminders.ts:146`);
   - the monthly report is generated (`packages/api/src/reports/monthly.ts:162-163`).
3. `syncClaims` also writes off by itself: it auto-closes claims whose discrepancy is no longer accepted (`service.ts:139-157`), auto-closes untouched never-claimable claims (`service.ts:161-184`), re-opens system write-offs that are accepted again, re-capped to the invoice (`service.ts:187-217`), and logs actor-less events (`service.ts:219-236`). New claims take what is left of the per-invoice cap (`service.ts:238-276`).
4. A re-match of an invoice deletes the bare `claimed` claims and refuses (CONFLICT) when money history exists (`service.ts:907-946`, called from `routers/match.ts:76`).

**Manual today:** 1 click per discrepancy to approve. Turning an approval into a claim needs no extra step, but it only becomes visible once a page or job runs `syncClaims`.
**Automatic:** idempotent materialisation, auto write-off and re-open, cap enforcement, advisory lock.
**Flag:** `recovery` (§7). With the flag off, the letters page still builds letters from the breakdown, but "mark as sent" shows *not tracked* (`apps/web/app/dashboard/leaks/claims/letter-actions.tsx:89-90`, `leaks/claims/page.tsx:67`).

---

## 3. Workflow B — Claim → credit-request letter → "sent"

**Who:** owner or manager (bookkeeper too, if they have the page). Route: `/dashboard/leaks/claims` (`apps/web/app/dashboard/leaks/claims/page.tsx`).

**What the system generates automatically:**
- One letter per supplier (`buildLetters`, `leaks/claims/letters.ts:123-247`), with a "before payment" section (this month's accepted lines on unpaid invoices, `letters.ts:171-188`) and a "for credit" section (tracker claims still in `claimed`, `letters.ts:190-215`).
- Undecided (open/escalated) lines are counted but never printed; they appear as a "decide" prompt (`letters.ts:176-184`, `page.tsx:97-101`).
- The ₪ basis of each line is explained from the engine's expected/actual values (`letters.ts:249-296`, `why.ts`). The reply-by date is today + 7 (`page.tsx:84`). The sender is the active restaurant plus its business id; the signer is the session user (`page.tsx:78-82`). The plain text for WhatsApp or email is built by `textOf` (`page.tsx:120-135`).
- The page loads up to 6 months of breakdown to give history claims their dates and bases (`page.tsx:36-37, 68-76`). That is 6+ `leakBreakdown` calls on every page view.

**Manual today, per supplier letter:**
1. Open `/dashboard/leaks/claims` (1 click from the leaks page or the home "needs you" row).
2. Choose **Print/PDF**, **WhatsApp** or **Email** (`letter-actions.tsx:51-59`). WhatsApp opens `https://wa.me/?text=…` with **no phone number** (`letter-actions.tsx:44`). Email opens `mailto:?subject=…` with **no address** (`letter-actions.tsx:45`). The user has to look up the supplier's contact in their phone or mail client, even though `suppliers.contact_whatsapp / contact_email` exist (`schema.ts:433-434`) and the orders flow already uses them (`apps/web/app/dashboard/orders/[poId]/detail-client.tsx:109, 155-177`). This is **re-typing or copying contact data between systems.**
3. Send from their own device. Nothing leaves the server (`letter-actions.tsx:11-14`).
4. Return to the tab and click **"mark as sent"**. A 10-second undo window follows (`UNDO_MS`, `recovery/deferred.tsx:9`), then `recovery.transition({to:'letter_sent'})` runs (`letter-actions.tsx:68-83`, `routers/recovery.ts:84-106`).

That is about 4–6 taps plus a contact lookup per supplier. If the user forgets step 4, the claim stays `claimed`, and the 7-day clock runs from `claimed_at` (`service.ts:71-72`).

**Not automated:** sending (by design: PR-only autonomy, plus "every money action human-confirmed"), attaching the PDF to the message, and confirming delivery or read status.

---

## 4. Workflow C — Chasing overdue claims (7 days)

**Automatic:** worker job `recovery-reminders`, scheduled `30 8 * * *` Asia/Jerusalem (`apps/worker/src/cron.ts:15-16, 106-110`), handler `apps/worker/src/jobs/recoveryReminders.ts:22-32`. It runs `enqueueRecoveryReminders` (`packages/api/src/recovery/reminders.ts:128-188`):
- for every restaurant with `recovery` on, it calls `syncClaims` and then `findOverdue` (`reminders.ts:35-78`). That query selects statuses `claimed / letter_sent / acknowledged` (`AWAITING_SUPPLIER`, `lifecycle.ts:178`) that are past `overdueSql`, excludes never-claimable types, and skips claims chased in the last 7 days (`REMIND_EVERY_DAYS`, `service.ts:324`);
- it sends one email per **owner/manager** (`MANAGER_ROLES`, `notifications/recipients.ts:28`) into `notifications_outbox` via `enqueueNotification`, deduped per restaurant+day+email (`reminders.ts:158-176`). The `outbox-dispatch` job delivers it every 60 s through Resend when `RESEND_API_KEY` is set, otherwise the result is `no_provider` (`apps/worker/src/jobs/outboxDispatch.ts:181-238`);
- it stamps `last_reminder_at` (`reminders.ts:177-180`).

The email goes to the restaurant, not the supplier ("A short call usually closes it", `reminders.ts:109-111`) and links to `/dashboard/recovery` (`reminders.ts:162`).

**In-app:** the home "needs you" rows `claimsUnsent` / `claimsWaiting` (`apps/web/app/dashboard/home/claims.ts:12-40`) and the countdown and banner on the tracker (`recovery/logic.ts:166-215`).

**Manual today:** the actual chase. The manager reads the email, opens the tracker, and calls or WhatsApps the supplier again from their own device, again without a pre-filled number. Each further reminder needs a new outreach. There is no "resend letter" action.

**Inconsistencies found:**
- `findOverdue` counts **each claim** from its own `COALESCE(letter_sent_at, claimed_at)` and includes `claimed` and `acknowledged` (`reminders.ts:43-51`). The web `followUps` counts a supplier as *waiting* based on its **latest** letter date, ignores `acknowledged`, and treats `claimed` as "unsent", not late (`recovery/logic.ts:186-215`). The email can therefore name ₪ and counts that the home row does not show. The code comment in `service.ts:66-69` says the rule is shared; only the day boundary actually is.
- The worker file header says "14+ days after the letter" (`apps/worker/src/jobs/recoveryReminders.ts:2-4`), but the code uses 7 (`claims.ts:34`). The comment is stale.
- The bookkeeper is never a recipient (`recipients.ts:28`), although the bookkeeper has full recovery access.

---

## 5. Workflow D — Credit note → credited → recovered

**Who:** owner, manager or bookkeeper, on `/dashboard/recovery` (`apps/web/app/dashboard/recovery/page.tsx:36-47`, `tracker-client.tsx`).

**Semi-automatic:** `recovery.creditLineSuggestions` lists **negative lines** on invoices from a supplier dated after its oldest open claim and not yet used by a credit note, up to 50 (`service.ts:654-696`, `routers/recovery.ts:131-133`). Picking a suggestion pre-fills the credit form with amount, number and date (`tracker-client.tsx:76-77, 635-658`). **The user still selects which claims it pays** (`tracker-client.tsx:76`, `service.ts:714-722`).

**Manual today:**
1. A credit note arrives on paper, in email or WhatsApp, or as a minus line on the next invoice.
2. If it is a separate document, the user types supplier, number, amount and date into the form (`routers/recovery.ts:109-129` requires `supplierId + amountAgorot + issuedOn` when no `invoiceLineId` is given). This is **re-typed data** from a document the product could OCR.
3. Select the claims and submit. `recordCreditNote` checks for duplicate number, line and idempotency key, allocates oldest-first, moves the claims to `credited`, and keeps any unallocated remainder on the note (`service.ts:723-885`). The UI reports the remainder (`tracker-client.tsx:96-106`).
4. Later, once the money or offset has actually happened, open the ⋯ menu, choose **"money back" (recovered)**, and confirm in a dialog that names the ₪ and a reason (`tracker-client.tsx:79, 124-166`). This is **fully manual**; nothing infers `recovered` from a paid invoice or a pay-run offset.
5. Write-off: the same dialog flow (`lifecycle.ts:156-162`).

Roughly 6–10 inputs per standalone credit note, and 3 clicks per "recovered".

**OCR gap:** the OCR model already classifies `documentKind: "credit_note"` ("חשבונית זיכוי"/"זיכוי") (`packages/ocr/src/providers/claudeVision.ts:88, 106`; `invoiceSchema.ts:23-26`). However, only `quote`/`other` are flagged as not-an-invoice (`packages/ocr/src/checks.ts:144, 221`), and **no consumer routes `credit_note` documents to `credit_notes` or recovery** (the only `documentKind` uses are `ocr/src/pipeline.ts:49`, `checks.ts:67, 221`, `types.ts:56`). A scanned credit note is either ingested as an ordinary invoice or ignored.

**Reporting:** `recovery.returnedThisMonth` feeds the hero tile (`routers/recovery.ts:135-138`). The monthly report adds returned and still-owed figures (`reports/monthly.ts:127-164`).

---

## 6. Supplier ledger (כרטסת) and pay run, as they touch claims

- `suppliers.ledger` / `suppliers.ledgerGrid` (flag `supplierLedger`, `packages/api/src/routers/suppliers.ts:159-180`) compute delivery notes against invoices per month, plus leak, **"credits asked"** and paid/open balance (`packages/api/src/ledger/ledger.ts:40-59, 147-188`).
  - "Credits asked" equals `claimableLines` of the month (`ledger.ts:229`), which **includes still-undecided `open/escalated` lines** (`claims.ts:13`). It is not what was actually sent.
  - The ledger **never reads `credit_notes` or `recovery_claims`**: no "credits received" column and no claim status. A bookkeeper reconciling the כרטסת has to cross-check the tracker by hand.
  - It is served by `invoiceReaderProcedure` = owner/manager/**receiver**/bookkeeper (`trpc.ts:158-160`). The ledger carries ₪, and **the owner rule says the receiver sees no ₪**. Flag this for tenant-security / product.
- The pay run (flag `payRun`, `routers/payRun.ts`) labels an invoice `claim` when only accepted claims remain, using the same `claimableLines` rule (`payRun.ts:18-32, 145`). It does **not** create a credit note or offset the payment. The app has no payment rail, so after paying net the user still records the credit by hand.

---

## 7. Flags and gating

| Gate | Where | Default |
|---|---|---|
| `recovery` (tracker, transitions, credit notes, reminders, hero tile) | `routers/recovery.ts:26-32, 136`; job `reminders.ts:144`; page 404 `recovery/page.tsx:36-37` | **OFF** unless `settings.features.recovery` or `all` is set (`packages/api/src/lib/features.ts:7, 62-71`); admin toggles it in `apps/web/app/admin/restaurants/[id]/FeaturesPanel.tsx:22` |
| `supplierLedger`, `payRun`, `monthlyReport`, `leakProof`, `monthlyDigestPreview` | `features.ts:18-45`, `routers/recovery.ts:38-46` | OFF |
| Kill switch `FEATURES_OFF=all\|recovery` | `features.ts:56-59` | env |
| Email delivery | `RESEND_API_KEY` (`outboxDispatch.ts:183, 217-218`) | without it the outbox row ends `no_provider` |
| WhatsApp delivery | `WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN`, otherwise `MockWhatsAppNotifier` (`packages/api/src/notifications/factory.ts:12-14`) | mock. Not used by recovery today in any case |
| Roles | `financeProcedure` (`trpc.ts:162`); `approve` = `deciderProcedure` (`approvals.ts:45`) | — |

Stubs and dead ends: the WhatsApp letter hand-off is a bare `wa.me` link (no Cloud API). There is no push provider (`outboxDispatch.ts:184, 237`). `credit_note` OCR kind has no consumer. `seed-recovery-demo.ts` is a demo-only seeding script (`apps/worker/scripts/seed-recovery-demo.ts:28, 57`).

---

## 8. Automation opportunities

| # | Trigger → action | Human still confirms | Data / reuse | Immutable? |
|---|---|---|---|---|
| O1 | **Eager claim creation:** `approvals.approve` (or a nightly job) calls `syncClaims`, so claims, the home row and the reminder clock start at decision time | none (no money moves) | `syncClaims` is idempotent and locked (`service.ts:130`); hook at `approvals.ts:376-420` | No (approvals router; `approvals/engine.ts` untouched) |
| O2 | **Pre-addressed letter hand-off:** fill `wa.me/<contact_whatsapp>` / `mailto:<contact_email>` from the supplier, as orders already do | user still taps send on their own device | `waLink/waPhone` pattern in `orders/[poId]/detail-client.tsx:109-177`; supplier row | No |
| O3 | **One-tap "send + mark sent":** the send button schedules the `letter_sent` transition (with the existing 10 s undo), so the claim cannot be left `claimed` after it was sent | user confirms the send; undo window | `useSharedDeferred` + `recovery.transition` (`letter-actions.tsx:40-83`) | No |
| O4 | **Server-sent letter (Phase-2):** "send letter" enqueues an email (PDF attached) or WhatsApp to the supplier through `notifications_outbox`, then marks `letter_sent` on dispatch | owner/manager approves each letter (money action, sent to a third party) | `enqueueNotification` with `attachments` (outbox supports them, `outboxDispatch.ts:197`); existing PDF/print layer; needs Resend/WhatsApp credentials (human Phase-6) | **Touches `notifications/outbox.ts` only if new fields are needed → HUMAN-PR**; credentials are human-only |
| O5 | **Supplier-facing chase:** on day 8, draft (not send) a pre-addressed reminder to the supplier, linked from the internal email and the home row | manager taps send | `findOverdue` output (`reminders.ts:35-78`) + O2 | No (job file); a change to `cron.ts` is HUMAN-PR |
| O6 | **Align the overdue rule:** a single shared `followUps`/`findOverdue` definition (acknowledged? per-supplier latest?), and fix the stale "14+ days" comment | owner decides whether `acknowledged` is chased | `reminders.ts:43-51` vs `recovery/logic.ts:186-215` | No |
| O7 | **Include the bookkeeper** (opt-in) in reminders and in a weekly "credits to record" digest | — | `recipientsForRestaurant(db, id, roles)` (`recipients.ts:35-39`) | No |
| O8 | **Auto-suggest credit allocation:** when an invoice with a negative line is matched (or `creditLineSuggestions` finds one), pre-select the same supplier's oldest open claims whose outstanding ≈ the line amount and raise a T2 "confirm credit ₪X" row | user confirms the allocation (`recordCreditNote`) | `creditLineSuggestions` (`service.ts:654-696`), `allocateCredit` (`lifecycle.ts:209`); trigger from the match job (`apps/worker/src/jobs/matchInvoice.ts`) | No (unless the matching engine is changed) |
| O9 | **OCR credit notes:** `documentKind=credit_note` → stage a draft `credit_notes` row (supplier, number, amount, date from OCR) and a suggestion, instead of ingesting it as an invoice | user confirms amount + claims | OCR already classifies it (`claudeVision.ts:88,106`); new staging path in `packages/ocr` / worker; probably a new migration for a "draft" state | **New migration / schema.ts → HUMAN-PR**; `checks.ts` is not immutable |
| O10 | **Recovered inference:** when an invoice of that supplier is marked paid net of a credit, or a pay-run "claim" invoice is paid, propose `credited → recovered` | owner confirms (money) | pay run `claim` status (`payRun.ts:18-32`); `transitionClaim` | No |
| O11 | **Ledger shows credits received + claim status** per month, and "credits asked" = sent claims, not undecided lines | — (read-only) | join `credit_notes` / `recovery_claims` in `ledger.ts:206-349` | No (ledger is not immutable; ₪-math in matching untouched) |
| O12 | **Ask tool `recovery_status`:** "who still owes me and how much?" | — | Ask tools today: `leak_hero/leak_report/leak_breakdown/claimable_lines` (`packages/api/src/ask/tools.ts:27`); `listClaims`/`summarize` | No |
| O13 | **Auto write-off proposal** for claims older than N days with no answer and below a ₪ threshold (owner rule) | owner confirms | `ageingBucket` (`lifecycle.ts:229-235`), `summarize` | No |

Constraints that keep every option above human-confirmed: "every money action human-confirmed" (owner rule); AGENTS.md prime directive 2 (no agent sends email/WhatsApp); credentials are Phase-6 human-only. `MISSING_ON_INVOICE` is never chased or claimed (already enforced at `claims.ts:22`, `reminders.ts:52-53`).

---

## 9. Immutable-list check

Files in this area that **are not** immutable: `lib/claims.ts`, `recovery/*`, `routers/recovery.ts`, `ledger/*`, `routers/payRun.ts`, `routers/approvals.ts`, the web pages, and `jobs/recoveryReminders.ts`. Each of these changes still needs its own PR.

Files that **are** immutable and would be touched by some opportunities:
- `packages/db/src/schema.ts` + new migrations (O9 draft credit notes; any new column, e.g. "letter channel" or "supplier acknowledgement source") → HUMAN-PR.
- `apps/worker/src/cron.ts` (any new schedule for O5/O7/O1-nightly) → HUMAN-PR. Logic can ride the existing `recovery-reminders` 08:30 run instead.
- `packages/api/src/notifications/outbox.ts` (if O4 needs new payload fields) → HUMAN-PR.
- `packages/matching/src/engine.ts` / `index.ts` (deltas, severities, types) → never changed by these opportunities. They only read them.
- `packages/api/src/approvals/engine.ts` (routing ₪50–300 / 2–5%) → O1 hooks the router mutation, not the engine.
