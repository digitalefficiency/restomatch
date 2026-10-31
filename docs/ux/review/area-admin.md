# Area review: Settings, team, exports, integrations, platform admin (`admin`)

**Reviewer:** UX review team · **Date:** 2026-10-25 · **Tree:** `main` worktree at `scratchpad/ux/wt`
**Routes:** `/dashboard/settings`, `/dashboard/team`, `/dashboard/exports`, `/dashboard/integrations`, plus the invite path (`/invite/accept` → `/login`), the Referral card (in settings), and `/admin`, `/admin/leads`, `/admin/restaurants/[id]` (code only).
**Screenshots:** `shots/dashboard_{settings,team,exports,integrations}__owner__{desktop-he,phone-he,desktop-en}.png`, `shots/dashboard_exports__bookkeeper__{desktop-he,phone-he}.png`, `shots/invite_accept__public__*.png`. Crops: `review/crops-admin/`.
**Archetypes (rubric §0.3):** Form (settings, team, invite), List (exports), with Queue-like rows (team roster, account-code mapping).

## Scores against world-class

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **4.5 / 10** | Every page is reachable and reflows without horizontal scroll, but settings is a 4,649 px single scroll with two separate save buttons, the code mapping has its only Save 2,000 px down, invites need an email address the door staff don't have, and the referral button overflows its card. |
| Desktop | **4.5 / 10** | Exports uses half of a 1,440 px canvas, settings has no section nav, the code mapping puts each label 800 px from its input, and three of four pages lack a real page title. Nothing is dense or scannable enough for a bookkeeper. |
| Functionality | **3.5 / 10** | The pipes exist: CSV, uniform file 1000, the Hashavshevet/Priority/Rivhit files, POS import, 2FA and invites. Missing: the effective approval rules (the fields render blank), export history and period lock, a preview of what the export contains, a real connect path for MarketMan/Zester, phone invites, branch-scoped roles, role descriptions, an audit log, notification preferences, and a plan & billing page. |

Lab caveats were applied: the worker banner, the cookie bar and its mid-page position, and `pointer:coarse` (the crawler did not emulate touch, so `smallTargets` overstates phone tap-target failures; the global 44 px rule in `globals.css:415` does apply on real phones).

---

## 1. What each page is today (walkthrough)

### 1.1 `/dashboard/exports` (owner and bookkeeper)
- **Desktop he** (`dashboard_exports__owner__desktop-he.png`): h1 "ייצואים להנהלת חשבונות". One `max-w-2xl` card sits on the start half and leaves the left half of the 1,440 px canvas empty. Inside it:
  - 4 preset chips and two native date inputs, which render **10/01/2026** (MM/DD) in `font-mono`.
  - Two **equal solid primaries**: green "הורדת CSV" and gold "הורדת קובץ אחיד".
  - With the `integrations` flag on: three small outline "הורדה" buttons (חשבשבת / פריוריטי / ריווחית) and a "כרטיסי החשבון" link.
  - A 12 px footnote that explains what is included.
- **Primary task, "send October to the accountant":** open the page (1), keep "החודש" or tap "החודש הקודם" (2), download (3), then find the file, open the mail app and attach it (4–7). Before step 3 you never see how many invoices, how much ₪ or how many exclusions. After it, a 3.5 s toast says "{n} חשבוניות". Skipped and garbled-character warnings arrive as 7 s auto-dismissing error toasts (`accounting-files.tsx:47-54`). Nothing records that October was exported, so nothing stops a second import into Hashavshevet.
- **Phone he:** the cards stack cleanly and no horizontal scroll appears (crawl `overflowX 0`). The date inputs are full-width. The footnote is the last thing on the page.
- **Bookkeeper:** identical page. The "כרטיסי החשבון" link goes to a page that is **read-only for the bookkeeper**, who is the person who owns the chart of accounts.

### 1.2 `/dashboard/integrations` (owner, manager, bookkeeper; flag `integrations`)
- **Desktop he** (`dashboard_integrations__owner__desktop-he.png`, 2,100 px). Three sections on one scroll:
  1. **כרטיסי חשבון:** three header codes, then **14 supplier rows**. Each row has the name at the right edge and a `w-44` input at the left edge, about 800 px apart. The ח״פ default shows as **placeholder** text, so a set value and a default look the same. One supplier shows the synthetic code **SA5B5F116**. A tiny `size="sm"` "שמירה" sits at the end.
  2. **מכירות מהקופה:** a CSV drop zone, then "ייבואים אחרונים: עוד לא יובאו מכירות".
  3. **מערכות רכש:** MarketMan and Zester cards. Each has a "לא מחובר" chip and a single "תצוגה על נתוני דוגמה" button. The only path to a real connection is the sentence "הבעלים מוסיפים את פרטי הגישה לפי הוראות ההפעלה בדוח האינטגרציות", shown to the owner, who has no such report.
- **Not in the nav** (`nav.tsx:108-111`). Reachable only from the exports link and a catalog header button.
- **Phone he:** 2,803 px. The mapping save button sits after all 14 stacked inputs, about 2,000 px below the first field.

### 1.3 `/dashboard/team` (owner manages; manager reads and sets language)
- **Desktop he:** title "צוות" is an **h2** (no h1; crawl `h1: []`). Below it:
  - An invite card: email, role select defaulting to "מקבל סחורה", language select, "שליחת הזמנה".
  - A roster: each member has a language `<select>`, a role `<select>` and a trash icon.
  - The Latin name renders as **".Somchai K"** in both viewports (`crops-admin/zoom_somchai_*.png`).
- **Role change = select `onChange` → server action.** There is no confirm and no undo. Promoting someone to **owner** is one mis-tap. The result banner renders **above the invite card**, out of view when you edit row 5 on a phone.
- **Remove** uses `window.confirm`.
- Every select on the page is disabled while any one action is pending.
- The roster shows no joined date (the `members.joined` string exists but is unused), last activity, 2FA state or branch.

### 1.4 Invite acceptance (`/invite/accept`)
- The email link goes to `/login?callbackUrl=/invite/accept?token…&email=…` (`team/actions.ts:50-55`).
- The invitee lands on the generic **"כניסה ל-RestoMatch"** card. Its **primary** path is email + password, which a new invitee does not have. The magic link they need is the secondary button. That means a **second email** before they reach the app.
- Nothing on the page says who invited them, to which restaurant, or as what role.
- After acceptance the app redirects to `/dashboard` (`invite/accept/page.tsx:41`). There is no welcome, no name capture, no language choice and no "add to home screen" for a receiver.
- `/invite/accept` without a token redirects silently to `/dashboard`, and logged out to `/login` (crawl `finalPath: /login`).

### 1.5 `/dashboard/settings` (all roles; restaurant sections owner-edit)
- **Desktop he:** 3,277 px; **phone he: 4,649 px**. No h1. Sections in order:
  1. החשבון שלי: language, password, devices.
  2. אבטחת חשבון: 2FA, with an "כבוי" chip.
  3. פרטי המסעדה: name, ח״פ, VAT "18", and timezone as **free text** "Asia/Jerusalem". The heading "פרטי המסעדה" appears twice. Save button 1.
  4. הגדרות התאמה: 5 tolerances (one **blank**), **6 approval thresholds, all blank**, and an OCR threshold (**blank**). Save button 2.
  5. חבר מביא חבר (referral). On a phone the redeem button **overflows the card edge**.
  6. פרטיות: "ייצוא הנתונים שלי" next to a **solid red "מחיקת החשבון שלי"** (`window.confirm`).
- **The blank fields are the defaults, hidden.** The engine applies ₪5,000 / ₪100 / ₪300 / 5% / ₪50 / 2% (`approvals/engine.ts:81-88`). The UI shows empty boxes and says "שדה ריק משאיר את הערך הקיים ללא שינוי". The owner cannot see the rules that block payment.
- Missing entirely: notification preferences, plan & billing, an audit log, the הצהרת נגישות link, and per-section anchors.

### 1.6 `/admin*` (platform staff, code only)
- **Visual:** dark-era `font-mono uppercase tracking-wider` table and section headers (`admin/page.tsx:98`, `restaurants/[id]/page.tsx:58,85`, `AssignPlanForm.tsx:36`, `OverridesForm.tsx:258`). The override inputs have **no associated labels** (`OverridesForm.tsx:262-273`).
- **Behaviour:** cross-tenant role change is select-on-change with no reason field (`MemberRoles.tsx:163-171`). Plan assign and overrides have no confirm.
- **Missing:** search, filters and a mobile nav. The wave-1 feature flags (`restaurants.settings.features`) are neither visible nor editable here. Only the 4 billing "features" are.

---

## 2. Findings

Severity: P0 = misleads a core task or loses money or trust · P1 = major friction or below benchmark · P2 = polish · P3 = nit.
"Human PR" = touches the AGENTS.md immutability list, or needs a credential, a schema change or an owner decision.

### P0

**admin-01 · P0 · trust · `/dashboard/settings` · owner (and manager/bookkeeper read-only) · both**
- **Problem:** the approval thresholds, the block-price tolerance and the OCR threshold render as **empty inputs**, although the engine enforces defaults (₪5,000 large invoice without PO, ₪100 unordered item, ₪300 / 5% cumulative, ₪50 / 2% medium). The owner cannot see the rules that send money to the approval queue or block payment. The copy "שדה ריק משאיר את הערך הקיים" confirms the value is hidden. Once overridden, a value can never return to the default.
- **Evidence:**
  - Shots: `dashboard_settings__owner__desktop-he.png` (crop 01, "ספי אישור" all blank), `…phone-he` crop 03.
  - Code: `apps/web/app/dashboard/settings/form.tsx:147-151,165-178` (`toDisplay` returns '' for undefined); `packages/api/src/routers/settings.ts:92-99` (`get` returns raw JSONB); `packages/api/src/approvals/engine.ts:81-88` (`DEFAULT_APPROVAL_THRESHOLDS`); `packages/matching/src/tolerances.ts:4` (`DEFAULT_TOLERANCES`).
- **Fix:**
  - `settings.get` returns `{ effective, overridden }` per key, computed with `resolveApprovalThresholds()` and `resolveTolerances()`. This is a **read-only import**: the immutable files are not edited.
  - Each field shows its effective value, plus a neutral chip "ברירת מחדל" or "הוגדר ע״י ‹שם› ב-‹תאריך›".
  - Add a per-field "החזר לברירת מחדל" link (`settings.update` accepts `null` = delete override).
  - Rewrite each rule as a sentence under its inputs: "חשבונית מעל ₪5,000 בלי הזמנת רכש → תור אישורים".
- **Exemplar:** Stripe Radar rules list (every rule shown with its live threshold and "default" badge); Ramp spend-policy editor (effective limits visible, change attributed).
- **Effort:** M · **Human PR:** no.

**admin-02 · P0 · trust · `/dashboard/team` · owner · both**
- **Problem:** the role `<select>` commits on change. Picking "בעלים" for a manager hands over full control, including the power to demote or remove you, with no confirm, no undo and no explanation. Picking "מקבל סחורה" for the bookkeeper silently cuts their finance access mid-close. Feedback appears in a banner at the **top** of the page, off-screen on a phone.
- **Evidence:** `team-client.tsx:239-255` (onChange → `updateMemberRole`), `team-client.tsx:105-136` (status card at the top); shot `dashboard_team__owner__phone-he.png` (crop 01: rows sit about 1,500 px below the banner); `systems.md` P20 lists "team role change (confirm)".
- **Fix:**
  - The select only stages the change. The row shows "שינוי: חשב/ת → בעלים · [שמור] [בטל]".
  - Promotion to owner opens `ConfirmDialog` with "להעביר ל-‹שם› הרשאות בעלים מלאות — כולל אישור תשלומים, שינוי כללים והסרת חברי צוות?" and a button that names the person.
  - A downgrade of a finance role shows what they lose.
  - Show the result inline on the row and announce it with `role=status`. Lock only that row while it is pending.
- **Exemplar:** GitHub "Change role" dialog listing permission deltas; Linear member role change confirmation; Google Workspace "Make super admin" double confirm.
- **Effort:** S · **Human PR:** no.

**admin-03 · P0 · a11y/legal · `/dashboard/settings` (+ shells) · all · both**
- **Problem:** there is no הצהרת נגישות page, and settings does not link one. Rubric F1 says reg. 35 requires it.
- **Evidence:** `ls apps/web/app/(marketing)` has no `accessibility`; no link in `settings/page.tsx`.
- **Fix:**
  - Build `/accessibility` (growth-pmm-engineer) with ת״י 5568 AA and WCAG 2.2 AA, the audit date, the browsers and readers tested, the known gaps, and the coordinator's contact and SLA.
  - Link it from the settings footer ("נגישות") and from every shell footer.
  - The coordinator name needs an **owner decision**.
- **Exemplar:** Kol Zchut and SII accessibility statements.
- **Effort:** S · **Human PR:** no (owner decision on the coordinator).

### P1

**admin-04 · P1 · trust/copy · `/dashboard/exports` · bookkeeper, owner · both**
- **Problem:** the subtitle promises "ייצוא חשבוניות **שאושרו**". The footnote reveals the file also includes invoices in dispute ("בחריגה"). A bookkeeper importing to Hashavshevet posts disputed amounts as payable, which is exactly the leak the product claims to stop. There is no per-status toggle.
- **Evidence:** `lib/i18n/messages/accounting/he.ts` (`subtitle` vs `note`); shot `dashboard_exports__bookkeeper__desktop-he.png`.
- **Fix:**
  - Status checkboxes: הותאמה ✓ · אושרה ✓ · שולמה ✓ · בחריגה ☐, default off for the accounting-package files.
  - Make the subtitle state the truth.
  - The CSV keeps a "סטטוס" column, plus a "₪ במחלוקת" column.
- **Exemplar:** Xero "Export to accounting" with status filters; Ramp accounting sync ("ready to sync" vs "needs review").
- **Effort:** M · **Human PR:** no (exports router, not immutable).

**admin-05 · P1 · functional · `/dashboard/exports` · bookkeeper · desktop**
- **Problem:** the user downloads blind. There is no preview of how many invoices, the ₪ total, VAT, the per-supplier split, or what was excluded (OCR pending, consolidated awaiting notes, duplicates, undated). The undated warning appears only **after** a download (`form.tsx:280-288`). Skipped invoices, Windows-1255 "?" substitutions and derived VAT arrive as up to 4 stacked toasts, with errors gone after 7 s.
- **Evidence:** `exports/form.tsx:136-167,280-288`; `exports/accounting-files.tsx:47-54`; `lib/components/Toast.tsx:28` (`error: 7000`).
- **Fix:**
  - Add an `exports.preview({from,to,statuses})` query.
  - Render a summary strip: "‏42 חשבוניות · ₪86,410 כולל מע״מ · מע״מ ₪13,180 · 3 לא נכללו ▾".
  - Below it, a compact table (date · ספק · מס׳ חשבונית · ₪ · סטטוס · כרטיס) with the excluded rows in a T4 group, each with its reason and a fix link.
  - Persistent warnings live inline in that panel, never in toasts.
- **Exemplar:** QuickBooks "Review and export"; Stripe report preview before "Download"; Puzzle close review.
- **Effort:** M · **Human PR:** no.

**admin-06 · P1 · functional · `/dashboard/exports` · bookkeeper · desktop**
- **Problem:** nothing records an export. There is no "exported by ‹name› on ‹date›", no period lock and no "only invoices not yet exported" mode. A second download of October re-imports every invoice into Hashavshevet as duplicates.
- **Evidence:** the `exports` router (`packages/api/src/routers/exports.ts:43,75`) returns content only; there is no log table.
- **Fix:**
  - An `export_runs` log: who, when, range, format, invoice ids, ₪ total.
  - An "ייצואים קודמים" list with re-download.
  - Mode radio: "רק חשבוניות שעוד לא יוצאו (ברירת מחדל)" / "הכל בטווח".
  - Invoices edited after export get a T2 "שונה אחרי ייצוא" stamp (erp-modern P23).
- **Exemplar:** Rillet close lock; Xero "Lock dates"; Ramp sync status per transaction.
- **Effort:** L · **Human PR:** **yes** (new table → `packages/db/src/schema.ts` + migration).

**admin-07 · P1 · flow · `/dashboard/exports` · owner (chain), bookkeeper · desktop**
- **Problem:** exports are per active branch (`ctx.session.restaurantId`). An accountant closing a 3-branch chain switches branch (full reload) and downloads three times. The files have no branch column.
- **Evidence:** `packages/api/src/routers/exports.ts:48,80`; branch switcher chip "כפר הזיתים 3" in every shot.
- **Fix:**
  - A scope chip "סניפים: כל הסניפים ▾" on exports (exec-desktop P19).
  - Produce one file with a "סניף" column, or one file per branch zipped.
  - Each branch is read through its own RLS context, with a COVERAGE entry.
- **Exemplar:** Toast multi-location report export; R365 location groups.
- **Effort:** M · **Human PR:** no (tenant-security-warden review).

**admin-08 · P1 · ia · `/dashboard/integrations` · owner, bookkeeper, manager · both**
- **Problem:** integrations has no nav entry. It is reachable only from a link on exports and a button on catalog, and the bookkeeper's nav lacks it. Integration settings are also split across four pages: codes and POS here; accounting files on exports; the email and WhatsApp intake addresses inside the Inbox (`inbox-client.tsx:423`); catalog import elsewhere.
- **Evidence:** `nav.tsx:108-111`; `ia-map.md` §"Routes with no nav entry"; shot `dashboard_exports__bookkeeper__desktop-he.png` (bookkeeper nav: 8 items, no integrations).
- **Fix:**
  - Add "חיבורים" to the ניהול group for owner, manager and bookkeeper.
  - Move the intake addresses (email, WhatsApp) into it as cards.
  - Keep a "Connections" health chip in the nav (see Big Move 4).
- **Exemplar:** Shopify settings sidebar ("Apps and sales channels"); Ramp Integrations page.
- **Effort:** S · **Human PR:** no.

**admin-09 · P1 · functional · `/dashboard/integrations` · bookkeeper · desktop**
- **Problem:** account codes are owner-edit only. The bookkeeper reads them with the note "רק הבעלים יכולים לשנות כרטיסי חשבון". In Israeli restaurants the bookkeeper or accountant owns the chart of accounts, and the owner usually doesn't know "חשבון מע״מ תשומות 3700".
- **Evidence:** `integrations/page.tsx:136` (`canEdit={role === 'owner'}`); `packages/api/src/routers/integrations.ts:195` (`ownerIntegrationsProcedure`).
- **Fix:**
  - Allow `bookkeeper` to write account codes, through a finance procedure.
  - Log each change in the audit with before and after values.
  - Show the owner a T4 line: "הקודים עודכנו ע״י אורית כהן (חשב/ת) ב-24.10".
- **Exemplar:** Ramp: the Accountant role owns GL mappings; QuickBooks Accountant user.
- **Effort:** S · **Human PR:** no (tenant-security-warden review; add a COVERAGE entry).

**admin-10 · P1 · trust · `/dashboard/integrations` · bookkeeper, owner · desktop**
- **Problem:** a supplier with no ח״פ silently gets a synthetic card code `S`+8 UUID hex. The shot shows **SA5B5F116** for "חקלאי העמק". That code exists in nobody's Hashavshevet, so the import fails or creates a junk card. Defaults are rendered as placeholders, so a set code and a default look the same.
- **Evidence:** `packages/api/src/routers/integrations.ts:189`; `accounting-mapping.tsx:276-289` (`placeholder={s.defaultAccount}`); shot `dashboard_integrations__owner__desktop-he.png` crop 00.
- **Fix:**
  - Render as a table: ספק · ח״פ · כרטיס בתוכנה · מקור. "מקור" reads "ברירת מחדל (ח״פ)" (neutral), "הוגדר" (ink) or **"חסר ח״פ"**, a warn chip with "הוסף ח״פ" linking to the supplier.
  - Never invent codes. Missing ones block that supplier in the file, with a visible count before export (ties to admin-05).
- **Exemplar:** Xero contact mapping with "unmapped" warnings; Ramp "Missing GL code" flags before sync.
- **Effort:** M · **Human PR:** no.

**admin-11 · P1 · flow · `/dashboard/integrations` · owner, manager · both**
- **Problem:** MarketMan and Zester are a dead end. Each card offers "לא מחובר" and "תצוגה על נתוני דוגמה". Activation is a sentence pointing the owner to a "דוח האינטגרציות" they cannot open. There is no connect, no "request connection" and no status of a pending request.
- **Evidence:** `integrations/procurement.tsx:246-255`; `messages/integrations/he.ts` `procurement.activate`; shot `…integrations…desktop-he` crop 01.
- **Fix:**
  - Primary "בקשו חיבור": collect the account email and branch, create a request row and show "בקשה נשלחה · נחזור תוך יום עסקים". Credentials stay Phase-6 human intake.
  - Keep the sample preview as a secondary text link.
  - Once connected, show the last sync, counts, errors and "סנכרן עכשיו".
- **Exemplar:** Toast Integrations directory ("Request access"); Plaid Link-style connect; Zapier connection health.
- **Effort:** M · **Human PR:** yes (real credentials = Phase-6; the request UI itself is not).

**admin-12 · P1 · states · `/dashboard/integrations` (POS) · owner, manager · desktop**
- **Problem:** importing a POS file **replaces** every day it covers. The preview never says so. The user learns "שורות קודמות שהוחלפו: N" from a toast after the fact. If the headers aren't recognised (any Tabit or Beecomm export variant), the only outcome is "חסרות עמודות", with no way to map columns by hand.
- **Evidence:** `pos-import.tsx:69-89` (save), `121-169` (preview has no replace count), `75-77` (toasts); `messages/integrations/he.ts` `pos.replaced`, `pos.errors.NO_COLUMNS`.
- **Fix:**
  - The preview returns `replacesRows` and `replacesDays`. The import button reads "ייבוא 1,240 שורות · יחליף נתונים של 01.10–15.10" and opens `ConfirmDialog` when it replaces anything.
  - Add a column mapper: one row per required field with a select of the file's headers. Remember it per POS.
- **Exemplar:** Flatfile/OneSchema column mapping; Shopify product CSV import (preview + overwrite warning).
- **Effort:** M · **Human PR:** no.

**admin-13 · P1 · ia · `/dashboard/settings` · all · both**
- **Problem:** one page holds six unrelated sections: personal, security, restaurant profile, matching rules, referral and privacy. It is 3,277 px on desktop and **4,649 px on a phone**, with no section nav, no anchors and no h1. It has **two separate Save buttons**, plus instant-save language and 2FA, so the save model is mixed. Nothing guards unsaved changes when you leave.
- **Evidence:** `settings/page.tsx:52-79`; `form.tsx:303-306`; `profile-form.tsx:106-109`; crawl heights 3277 / 4649; shot crops `…settings…phone-he__00..05`.
- **Fix:** a settings shell (Big Move 1).
  - Desktop: a start-side sub-nav with the items חשבון · אבטחה · התראות · המסעדה · כללי התאמה ואישור · תוכנית וחיוב · פרטיות. Each is its own route (`/dashboard/settings/rules`…).
  - Phone: the same items as a grouped list (iOS Settings) that pushes one section at a time.
  - Per section: one save model, a sticky "יש שינויים שלא נשמרו · [שמור] [בטל]" bar, and a `beforeunload` guard.
- **Exemplar:** Linear settings; Stripe Dashboard settings index; iOS Settings grouped list.
- **Effort:** M · **Human PR:** no.

**admin-14 · P1 · trust · `/dashboard/settings` · owner · both**
- **Problem:** VAT rate, timezone, tolerances and approval thresholds drive the leak ₪, but changing them writes **no audit row**. Only `setMyLocale` audits. There is no change history and no impact preview. VAT is a free number input; timezone is free text for an Israel-only product. An owner (or a compromised owner session) can quietly shrink the leak number, and nobody can later explain why October's ₪ moved.
- **Evidence:** `packages/api/src/routers/settings.ts:106-139` (update, no `recordAudit`), `162-181` (updateProfile, no `recordAudit`); `profile-form.tsx:79-102`.
- **Fix:**
  - Call `recordAudit` with before and after on both mutations.
  - A "היסטוריית שינויים" drawer per section.
  - VAT becomes a read-only "18% (שיעור ארצי, מ-01.01.2025)" with an "שנה…" link to a dialog naming the effect ("ישנה את חישוב המע״מ בחשבוניות מהיום והלאה").
  - Timezone becomes a select, or is hidden while Israel is the only market.
- **Exemplar:** Stripe settings audit ("Security history"); Ramp audit log; QuickBooks Audit log.
- **Effort:** S (audit) / M (history UI) · **Human PR:** no.

**admin-15 · P1 · flow · `/dashboard/settings` · owner · both**
- **Problem:** "מחיקת החשבון שלי" is a solid red button directly beside "ייצוא הנתונים שלי" and is guarded only by `window.confirm`. The note says to "transfer ownership first", but no transfer-ownership flow exists. The only way is the role select of admin-02.
- **Evidence:** `settings/dsr.tsx:52-76`; shot `…settings…desktop-he` crop 02, `…phone-he` crop 04.
- **Fix:**
  - Move it into a separate "אזור מסוכן" card at the end, as an outline-danger button.
  - `ConfirmDialog` requires typing the restaurant name and names what disappears.
  - If the user is the sole owner with members, show "העבר בעלות…" (pick a member) first, inline.
- **Exemplar:** GitHub "Danger zone" with typed confirmation; Vercel delete project.
- **Effort:** S · **Human PR:** no.

**admin-16 · P1 · functional · `/dashboard/settings` · all · mobile**
- **Problem:** there are no notification preferences. No channel per event (push, WhatsApp, email), no quiet hours, no digest opt-in. Receivers and managers live on phones (FG-19), and rubric D9 puts the preferences UI in scope.
- **Evidence:** `grep notificationPref|quietHours` → 0 in `apps/web/app` and `packages/api/src/routers`.
- **Fix:**
  - A "התראות" section: a matrix of events (חסימת תשלום ≥₪500, חשבונית כפולה, אי-התאמה בקבלה, דוח יומי) × channels, filtered by role.
  - Quiet hours default to 23:00–06:00 plus Shabbat.
  - The routing rules themselves are a proposal for `outbox.ts` and `cron.ts`.
- **Exemplar:** Linear notification settings; Apple interruption levels; Slack per-channel preferences.
- **Effort:** M · **Human PR:** yes (delivery/cron in `outbox.ts` and `cron.ts` are immutable; the preferences UI and storage are not).

**admin-17 · P1 · functional · `/dashboard/settings` · owner · both**
- **Problem:** the app has no plan & billing page. Owners cannot see their plan, usage against limits (invoices this month, seats, branches), RestoMatch invoices or the payment method. Every `EntitlementUpsell` sends a logged-in owner to the public marketing `/pricing`.
- **Evidence:** `lib/components/EntitlementUpsell.tsx:55,81`; no billing route under `app/dashboard`.
- **Fix:**
  - "תוכנית וחיוב": plan name, renewal date, a usage meter ("‏312 / 500 חשבוניות החודש"), seats and branches, invoice history, and "שדרוג" opening an in-app comparison.
  - Pricing and entitlements are read from `plans.ts` and `packages/billing` and never redefined.
- **Exemplar:** Linear Billing; Stripe Billing customer portal; Notion Plans.
- **Effort:** M · **Human PR:** **yes** (`packages/billing/*`, `plans.ts`, payment rail).

**admin-18 · P1 · flow · `/dashboard/team` · owner, manager · mobile**
- **Problem:** invitations go by **email only**. Receivers, chefs and shift managers at the back door often have no work email (FG-18). There is no phone or WhatsApp invite, no QR or join link, and no shared-tablet PIN. The owner standing next to the new receiver can't onboard them in 30 seconds.
- **Evidence:** `team-client.tsx:142-187`; `team/actions.ts:57-83` (email only); `functional-gaps.md` FG-18.
- **Fix:**
  - The invite form gets "איך לשלוח?" with three options: SMS/WhatsApp to a phone number, a link to copy, or a QR on screen. The SMS/WhatsApp send is human-PR via the outbox; copy and QR work today.
  - The role defaults by context.
  - Add a PIN path for shared devices (FG-18; schema → human).
- **Exemplar:** 7shifts and Toast employee invites (SMS); Square Team PIN; Deputy QR onboarding.
- **Effort:** M · **Human PR:** yes (outbox sends and the PIN schema; copy link and QR need neither).

**admin-19 · P1 · flow · `/invite/accept` → `/login` · invitee (all roles) · mobile**
- **Problem:**
  - The invitee lands on a generic login whose primary CTA is "כניסה" with a password they don't have. The magic link is the secondary path and costs a second email.
  - Nothing shows the inviter, the restaurant or the role.
  - After accepting, the app dumps them on the owner-style `/dashboard`. There is no name capture (members without a name display as an email), no language choice, no "add to home screen" for receivers and no first task.
- **Evidence:** `team/actions.ts:50-55`; `login/page.tsx:145-200`; `invite/accept/page.tsx:41`; shot `invite_accept__public__phone-he.png`.
- **Fix:**
  - A dedicated `/invite/[token]` landing: "רון אלמוג הזמין/ה אותך להצטרף ל**כפר הזיתים** כ**מקבל/ת סחורה**". One primary "הצטרפות" sends the magic link, or a phone OTP once admin-18 lands.
  - Then a 3-step welcome: name · language (incl. ar/ru/th/ti for receivers) · install the app. It ends on the role's home (D1).
- **Exemplar:** Slack and Linear workspace invite landings; Notion "Join workspace"; Ramp employee onboarding.
- **Effort:** M · **Human PR:** no (auth flow; tenant-security-warden review).

**admin-20 · P1 · ia · `/dashboard/team` · owner · both**
- **Problem:** roles have no descriptions or permission preview. The invite helper explains only "מקבל סחורה". The owner picks "חשב/ת" or "מנהל/ת" without knowing who can approve payments, change rules or export.
- **Evidence:** `team-client.tsx:156-167` (bare `<option>` labels); `messages/team/he.ts` `invite.subtitle`.
- **Fix:**
  - Replace the native select with a radio list or sheet. Each role gets one line ("מנהל/ת — מאשר/ת חריגות עד ₪300, מזמין/ה סחורה, לא רואה ייצוא") and an expandable "מה מותר?" matrix generated from `ROUTE_ROLES` and the procedure tiers.
- **Exemplar:** Notion and Linear role pickers with descriptions; Ramp role permission table.
- **Effort:** S · **Human PR:** no.

**admin-21 · P1 · functional · `/dashboard/team` · owner (chain) · desktop**
- **Problem:** the roster and invites are per active branch. A 3-branch owner switches branch (full reload) and re-invites the same area manager three times. No view shows who has access where.
- **Evidence:** `packages/api/src/routers/team.ts:66-78` (`list` scoped to `ctx.session.restaurantId`); branch chip "3".
- **Fix:**
  - Invite gets "סניפים: ☑ כל הסניפים / בחירה". It writes one membership per branch through each branch's context.
  - With "כל הסניפים", the roster gains a "סניפים" column and a per-person role per branch.
- **Exemplar:** Toast multi-location employee access; 7shifts locations per employee.
- **Effort:** M · **Human PR:** no (tenant-security-warden review; COVERAGE entry).

**admin-22 · P1 · states · `/dashboard/exports`, `/dashboard/integrations` · bookkeeper, owner · both**
- **Problem:** accounting-relevant warnings are shown as auto-dismissing toasts:
  - "לא נכללו חשבוניות בלי מספר, תאריך, סכום או ספק: N"
  - "תווים … נכתבו כ-?" (Hebrew supplier names garbled in the Hashavshevet file)
  - POS "rejected days"

  Error toasts vanish after 7 s, and up to 4 stack after one click (C9).
- **Evidence:** `accounting-files.tsx:52-54`; `pos-import.tsx:75-77`; `Toast.tsx:28`.
- **Fix:**
  - Return these counts into a persistent result panel under the button: "הקובץ ירד · 42 חשבוניות · ⚠ 2 לא נכללו (פירוט) · ⚠ 3 שמות ספק עם תווים שהוחלפו".
  - Each line links to the fix.
  - Errors never auto-dismiss (R-6).
- **Exemplar:** Polaris Banner for persistent warnings; QuickBooks import results summary.
- **Effort:** S · **Human PR:** no.

**admin-23 · P1 · trust · `/admin/restaurants/[id]` · platform admin · desktop**
- **Problem:** platform staff change a customer's member roles (select-on-change), plan and entitlement overrides with no confirm and **no reason field**. The audit row has no "why". The wave-1 feature flags that actually gate the customer's UI (`restaurants.settings.features`) are invisible here, so support can't answer "why can't I see contracts?".
- **Evidence:** `admin/restaurants/[id]/MemberRoles.tsx:163-171`; `AssignPlanForm.tsx:51-56`; `OverridesForm.tsx:239-251,197`; `lib/ingest/features.ts`.
- **Fix:**
  - Every write opens a dialog with a required "סיבה / מספר פנייה". Store it in the audit `after`.
  - Show a read-only "פיצ׳רים פעילים" list (`FEATURE_KEYS` × `featureEnabled`) with the source: plan, override or wave-1 flag.
  - Add search and filters on `/admin`.
- **Exemplar:** Stripe internal "reason required" admin actions; Intercom/Zendesk impersonation with reason.
- **Effort:** M · **Human PR:** no (the admin router is not on the list; tenant-security-warden review).

### P2

**admin-24 · P2 · a11y · `/dashboard/team`, `/dashboard/settings` · all · both**
- **Problem:** no `<h1>`. `SectionHeader` defaults to `level=2`, so the page title is an h2 and the tab `<title>` is just "RestoMatch" (crawl `h1: []`, `title: RestoMatch`).
- **Evidence:** `team/page.tsx:22`; `settings/page.tsx:55`; crawl rows for both routes.
- **Fix:** pass `level={1}` for the first header and a per-route `<title>` ("צוות · RestoMatch", "הגדרות · RestoMatch"). The settings sub-sections become h2.
- **Exemplar:** Primer page structure; gov.il.
- **Effort:** S · **Human PR:** no.

**admin-25 · P2 · rtl · `/dashboard/team` · owner, manager · both**
- **Problem:** Latin names lose isolation: "Somchai K." renders as **".Somchai K"**. `originalProps()` returns `{}` for non-Hebrew text, so the value inherits the RTL paragraph (E3). The same helper is used wherever names render.
- **Evidence:** `lib/i18n/original.tsx:11-13`; `team-client.tsx:205-209`; `crops-admin/zoom_somchai_desk.png`, `zoom_somchai_phone.png`.
- **Fix:** render data names in `<bdi>` (`<Original value=…/>` = `<bdi {...originalProps}>`), or have `originalProps` return `dir: 'auto'` for every non-empty value on an inline element. Add the bidi-torture tenant to e2e.
- **Exemplar:** W3C inline bidi markup; Gmail address isolation.
- **Effort:** S · **Human PR:** no.

**admin-26 · P2 · states · `/dashboard/team` · owner · both**
- **Problem:**
  - "Remove" uses `window.confirm`, while `ConfirmDialog` exists.
  - Revoking an invite has no undo.
  - All selects lock while any one action is pending.
  - Result messages render far from their trigger (C9/C10).
- **Evidence:** `team-client.tsx:256-270,308-316,219,242`.
- **Fix:**
  - `ConfirmDialog` with "הסר את ‹שם› מכפר הזיתים · הגישה תיחסם מיד".
  - Revoke = optimistic + 10 s Undo.
  - Per-row pending state; inline row result.
- **Exemplar:** Linear member removal dialog; Superhuman undo.
- **Effort:** S · **Human PR:** no.

**admin-27 · P2 · functional · `/dashboard/team` · owner · desktop**
- **Problem:** the roster has no context: no joined date (the `members.joined` string is unused), no last active, no 2FA state, no invite-accepted status, no branch. The owner can't spot a stale ex-employee with access, or a bookkeeper without 2FA.
- **Evidence:** `team-client.tsx:201-277`; `messages/team/he.ts` `members.joined`.
- **Fix:** a compact table: שם · תפקיד · סניפים · 2FA (✓ / "כבוי" as a warn chip for money roles) · פעיל/ה לאחרונה (relative + absolute tooltip) · הצטרף/ה. Sort by last active, and add a filter "לא פעילים 30+ יום".
- **Exemplar:** Google Workspace user list; GitHub org people (2FA column).
- **Effort:** M · **Human PR:** no (last-active may need a column → schema, human).

**admin-28 · P2 · desktop · `/dashboard/integrations` · owner, bookkeeper · desktop**
- **Problem:**
  - Desktop: in the code mapping, each supplier label sits at the start edge and its `w-44` input at the far end, about 800 px apart. A 14-row zigzag.
  - Phone: 14 full-width stacked inputs, with the only Save (`size="sm"`, about 28 px on desktop) after them.
  - No dirty indicator and no leave guard.
- **Evidence:** `accounting-mapping.tsx:265-304`; shots `…integrations…desktop-he` crop 00/01, `…phone-he` crops 01–02.
- **Fix:**
  - Desktop: a compact `<table>` (32 px rows, B6 compact) with columns ספק · ח״פ · כרטיס · מקור (see admin-10), inline edit, and a sticky save bar with the dirty count ("3 שינויים").
  - Phone: a list of rows showing name + code; tap one to edit in a bottom sheet.
- **Exemplar:** Airtable/Linear inline-edit tables; Xero chart-of-accounts mapping grid.
- **Effort:** M · **Human PR:** no.

**admin-29 · P2 · visual · `/dashboard/exports` · bookkeeper, owner · desktop**
- **Problem:**
  - Two equal **solid** primaries sit side by side: green CSV and **gold** uniform file. Gold is the T3 "recovered money" colour, misused for a file format.
  - The bookkeeper's actual software (Hashavshevet etc.) gets three small outline buttons.
  - The card is `max-w-2xl`, so half the 1,440 px canvas is empty, while the 12 px note explaining inclusion rules is buried at the bottom.
- **Evidence:** `exports/form.tsx:172,245-276`; `accounting-files.tsx:88-98`; shot `dashboard_exports__owner__desktop-he.png`.
- **Fix:**
  - Remember "התוכנה של רו״ח: [חשבשבת ▾]" per restaurant. Show one primary "הורדת קובץ לחשבשבת · אוקטובר". Put CSV, uniform 1000 and the others under "פורמטים נוספים ▾".
  - Use a 2-column desktop layout: controls at the start, the preview (admin-05) at the end.
- **Exemplar:** Ramp accounting "Export to ‹your ERP›" single CTA; Apple HIG one prominent button.
- **Effort:** S · **Human PR:** no.

**admin-30 · P2 · rtl · `/dashboard/exports` · bookkeeper, owner · both**
- **Problem:** the native `type="date"` inputs render **10/25/2026** (MM/DD) on any English-UI browser while the page is Hebrew, set in `font-mono` (E8 "never MM/DD"; B2).
- **Evidence:** `exports/form.tsx:202-224`; shots `dashboard_exports__owner__desktop-he.png`, `…phone-he` crop 00.
- **Fix:**
  - Replace with a range field showing "01.10.2026 – 25.10.2026" (he-IL, Heebo tabular). It opens a calendar whose first column is א׳ and lists the presets on the side.
  - Add a "חודש קודם" stepper ‹ אוקטובר 2026 ›, since accountants think in months.
- **Exemplar:** Stripe date-range picker (presets + calendar); Israeli bank statement month stepper.
- **Effort:** M · **Human PR:** no.

**admin-31 · P2 · flow · `/dashboard/settings` · owner · desktop**
- **Problem:** money and percentage rules are `type="number"` inputs (C7): a scroll wheel changes ₪ thresholds. Percentages are typed as whole numbers with a "5 = 5%" helper. There is no ₪ or % adornment, and no validation messages.
- **Evidence:** `settings/form.tsx:242-250,269-277,289-299`; `profile-form.tsx:80-90`.
- **Fix:** `type="text" inputMode="decimal" dir="ltr"`, with a ₪ or % adornment at the end edge. Accept "7,5"; format on blur; show field-level errors in Hebrew ("אחוז בין 0 ל-100"). The model is `inventory/count/count-screen.tsx`.
- **Exemplar:** Stripe CurrencyField.
- **Effort:** S · **Human PR:** no.

**admin-32 · P2 · visual · `/dashboard/settings` (Referral) · owner, manager · mobile**
- **Problem:**
  - At 390 px the "מימוש" button overflows the card edge: the input lacks `min-w-0`.
  - The Hebrew placeholder "הקלידו קוד הפניה" renders in a `font-mono` LTR field and looks letter-spaced.
  - Submit stays disabled until 6 characters, with no reason shown (C6).
  - A growth card sits between the matching rules and privacy.
- **Evidence:** `lib/growth/ReferralCard.tsx:97-113`; shot `…settings…phone-he` crop 04 (button at x=24 vs the card edge at x=34).
- **Fix:**
  - Use `min-w-0` on the input, and `rtl:text-right` with a Heebo placeholder.
  - Keep submit enabled and validate on submit.
  - Move the card to "תוכנית וחיוב" (admin-17).
- **Exemplar:** Dropbox/Notion referral cards inside Billing.
- **Effort:** S · **Human PR:** no.

**admin-33 · P2 · a11y · area-wide · all · both**
- **Problem:** focus rings and colours bypass the tokens:
  - `focus-visible:ring-primary/60` (2.7:1, below the F3 3:1) on the preset chips, the mapping link and every team select.
  - Alpha-hacked semantics (`bg-primary/12`, `bg-warn/5`, `border-danger/30`).
  - `border-line` (1.39:1) as the referral input border.
- **Evidence:** `exports/form.tsx:187-190`; `accounting-files.tsx:74`; `team-client.tsx:55-56`; `ReferralCard.tsx:105`; `settings/form.tsx:222`.
- **Fix:** use the `--c-focus` ring token (R-5) and role tokens (B8). A control border is `line-strong`.
- **Exemplar:** Primer focus ring; Atlassian colour roles.
- **Effort:** S · **Human PR:** no.

**admin-34 · P2 · rtl · `/dashboard/team`, `/dashboard/settings` · owner, receiver · mobile**
- **Problem:** the team-invite and personal-language choices offer only עברית / English / לפי המכשיר. The product ships receiver languages (ar/ru/th/ti, S14). The invite copy says "עובד שלא דובר עברית — בחרו English", which is wrong for an Arabic- or Tigrinya-speaking receiver (E10).
- **Evidence:** `team-client.tsx:78-82`; `settings/account-section.tsx:175-178`; `messages/receiverLangs/*`.
- **Fix:** when `receiverLangs` is on, list all six languages for receiver and chef, each with its endonym (العربية, Русский, ไทย, ትግርኛ). Rewrite the helper copy.
- **Exemplar:** WhatsApp language picker (endonyms); Deputy multilingual staff onboarding.
- **Effort:** S · **Human PR:** no.

**admin-35 · P2 · visual/a11y · `/admin*` · platform admin · desktop**
- **Problem:**
  - Dark-era `font-mono uppercase tracking-wider` headers on Hebrew (E6, J3).
  - The override inputs have no associated labels: the `<label>` wraps nothing and the spans are not labels (F10).
  - Money in leads is set in mono gold (B2).
  - No mobile nav, no search.
- **Evidence:** `admin/page.tsx:98`; `admin/leads/page.tsx:20,57`; `restaurants/[id]/page.tsx:58,85`; `OverridesForm.tsx:258-273`; `AssignPlanForm.tsx:36`.
- **Fix:** reuse `SectionHeader`, `Field`, `DataTable` and `<Money>` from the dashboard; gate tracking behind `ltr:`; associate every input with a label; add a search box.
- **Exemplar:** Linear admin; Vercel Geist tables.
- **Effort:** S · **Human PR:** no.

**admin-36 · P2 · flow · `/dashboard/settings` · all · both**
- **Problem:** "ניתוק מכל המכשירים" is the only session control. It uses `window.confirm` and shows no list of active sessions (device, location, last seen). You cannot revoke one lost phone without logging out the office PC too.
- **Evidence:** `settings/account-section.tsx:242-258`.
- **Fix:** a sessions list with per-row "נתק", plus "נתק את כל השאר". `ConfirmDialog` for the all-devices option.
- **Exemplar:** GitHub and Google account "Devices / Sessions".
- **Effort:** M · **Human PR:** yes (a sessions table/schema if not present).

### P3

**admin-37 · P3 · copy · `/dashboard/integrations`, `/dashboard/settings` · owner · both**
- **Problem:**
  - Brand naming drifts: "Market Man" on the card versus "MarketMan" in the copy.
  - "פרטי המסעדה" appears twice (section and card title).
  - Language can be changed in the header **and** in a settings card.
  - "ייצואים להנהלת חשבונות" is a plural noun title rather than a job.
- **Evidence:** `procurement.tsx:236` (`p.displayName`); `settings/profile-form.tsx:52`; shot `…settings…desktop-en` crop 00 ("Restaurant details" twice).
- **Fix:** use "MarketMan" everywhere. Drop the card title when it repeats the section. Keep language in settings, with the header switcher as a shortcut that says where it saves. Title exports "סגירת חודש וייצוא לרו״ח" (exec-desktop P21).
- **Exemplar:** Polaris voice and tone.
- **Effort:** S · **Human PR:** no.

---

## 3. Big moves (benchmark-grade)

### BM-1 · Settings as a control centre, not a scroll
- **Why:** settings, team and integrations are where owners decide **what counts as a leak**. Today that decision hides in a 4,600 px scroll with blank rule fields.
- **What:**
  - **Desktop:** a two-pane shell. The sub-nav sits at the start edge, grouped מסעדה (פרטים, כללי התאמה ואישור, חיבורים, צוות) · אני (חשבון, אבטחה, התראות) · חשבון RestoMatch (תוכנית וחיוב, פרטיות, נגישות). Each item is its own route with an h1.
  - **Phone:** the iOS-Settings grouped list pushes one section per screen, with a sticky save bar inside the thumb zone.
  - ⌘K gets a "הגדרות: מע״מ" deep link.
  - Every setting shows its effective value, its source (ברירת מחדל / הוגדר ע״י ‹שם›) and its change history.
- **Exemplar:** Linear Settings; Stripe Dashboard settings index; iOS Settings.
- **Device:** both · **Effort:** M.

### BM-2 · Rules studio with a 30-day backtest
- **Why:** the North Star is a leak ₪ *the owner believes*. If tolerances can move silently, the number isn't trustworthy. If the owner can't see what a change does, they won't touch the rules, or they'll break them.
- **What:**
  - Each rule is a sentence with inline values: "חריגת מחיר מעל **2%** או **₪5** → מסומנת · מעל **8%** → חוסמת תשלום · חשבונית מעל **₪5,000** בלי הזמנה → תור אישורים".
  - Editing a value runs a backtest over the last 30 days of matches before saving: "עם הערכים החדשים: ‎−4 חריגות · ‎−₪612 בדליפה · ‎+2 אישורים ממתינים".
  - Save is versioned (who / when / why), and "חזור לגרסה" works.
  - Reads `resolveTolerances` and `resolveApprovalThresholds` and never redefines them. A new rule type is a human proposal to `engine.ts`.
- **Exemplar:** Stripe Radar rule testing ("would have blocked N payments"); Ramp policy simulation; Brex rule versions.
- **Device:** desktop · **Effort:** L.

### BM-3 · "סגירת חודש וייצוא לרו״ח": the bookkeeper's close-and-export desk
- **Why:** the bookkeeper's job is "close October without double-posting". The current page is three download buttons with no preview, no memory and one branch at a time.
- **What:** `/dashboard/exports` becomes a 2-column desk.
  - **Start column:**
    - The close checklist (erp-modern P23 / exec-desktop P21, auto-ticked from data).
    - Month stepper and branch scope.
    - "התוכנה שלכם: חשבשבת" and one primary "ייצוא אוקטובר לחשבשבת".
    - Status toggles (admin-04).
  - **End column:**
    - A live preview table of exactly what goes in the file: totals strip, then rows.
    - Excluded rows, each with its reason and a fix link.
    - Missing card codes and missing allocation numbers as T2 lines.
  - **After export:**
    - A logged run with a period lock ("נסגר ע״י אורית כהן ב-03.11").
    - Re-download, and "רק מה שחדש מאז".
    - A one-click "חבילה לרו״ח": zip of file + invoice images + PDF summary, sent to the accountant's email. The send is human-PR via the outbox.
- **Exemplar:** Rillet close checklist and lock; Xero "Lock dates"; QuickBooks Accountant review; Ramp accounting sync status.
- **Device:** desktop · **Effort:** L (schema for the export log → human PR).

### BM-4 · Connections hub with health
- **Why:** the "no double entry" promise depends on six pipes: accounting file, POS sales, MarketMan/Zester, email intake, WhatsApp intake and, later, the bank. They are scattered over four pages; two are dead ends and none shows health.
- **What:**
  - One "חיבורים" page in the ניהול nav. A directory of tiles grouped הנהלת חשבונות · קופה · רכש · קליטת חשבוניות.
  - Each tile shows: status chip (מחובר ✓ / נדרשת פעולה ⚠ / לא מחובר — T4), last sync with its absolute time, counts, the last error in plain Hebrew with one fix CTA ("חבר מחדש", "הוסף ח״פ ל-2 ספקים", "מפה עמודות"), and the primary action. Credentialed systems get "בקשו חיבור".
  - A nav dot appears only when something needs action.
  - The intake email/WhatsApp addresses move here from the Inbox.
- **Exemplar:** Ramp Integrations page; Toast integrations directory; Zapier connection health; Linear integrations settings.
- **Device:** both · **Effort:** M (live connectors are Phase-6 human).

### BM-5 · Team and access, mobile-first: invite at the back door in 30 seconds
- **Why:** most of the work happens on phones at the door. Adoption by receivers is what feeds the goods receipt (GR), and today they need a work email, two emails and a password form.
- **What:**
  - **Invite sheet:** phone number (WhatsApp/SMS link) · copy link · QR shown on the owner's phone. It also offers a role picker with one-line descriptions and a "מה מותר?" matrix, and branch multi-select.
  - **Invitee landing:** "רון הזמין/ה אותך לכפר הזיתים כמקבל/ת סחורה". One button joins, followed by a 3-step welcome (name, language including ar/ru/th/ti, install the app) that lands on "המשלוחים של היום".
  - **Shared tablet:** a personal PIN per receiver or chef, with auto-lock and per-person audit (FG-18).
  - **Roster:** staged role changes with confirm (admin-02), a 2FA column, last active, and a filter for stale access.
- **Exemplar:** 7shifts and Toast SMS invites; Square Team PINs; Slack and Linear invite landings; Notion role picker.
- **Device:** mobile · **Effort:** L (PIN schema + outbox sends → human PR).

### BM-6 · Security and audit centre
- **Why:** this product touches money approvals. Owners and accountants must be able to answer "who changed the rules, who promoted whom, who exported October" without asking support.
- **What:**
  - "אבטחה ויומן שינויים":
    - A filterable audit log (team, rules, VAT, codes, exports, plan) with who / when / before → after.
    - "Require 2FA for owner, bookkeeper and manager" as a restaurant policy, with a progress line ("2 מתוך 4 הפעילו").
    - An active-sessions list with per-session revoke.
    - Alerts for sensitive changes: new owner, rule loosened by more than X, export of a closed month.
  - Platform admin actions on the tenant appear here too, labelled "RestoMatch support", with the reason.
- **Exemplar:** GitHub org security and audit log; Google Workspace security centre; Ramp audit trail.
- **Device:** desktop · **Effort:** M (enforcement and session storage may need schema → human PR).

---

## 4. Rubric scorecard (this area)

| Criterion | Settings | Team | Exports | Integrations | Admin |
|---|---|---|---|---|---|
| B1 type scale | Partial (12 px notes) | Pass | Partial (12 px footnote and labels) | Partial | Fail (mono caps) |
| B2 money face | N/A | N/A | N/A | Fail (POS ₪ in mono) | Fail |
| B6 density | Fail (no compact) | Partial | Fail | Fail | Partial |
| B9 layout/width | Fail (one long scroll) | Pass | Fail (half canvas) | Partial | Partial |
| C5 forms/save model | Fail (mixed, no guard) | Partial | Pass | Fail (no guard) | Fail (labels) |
| C6 validation | Fail | Partial | Pass | Pass | Fail |
| C7 amount inputs | Fail (`type=number`) | N/A | N/A | N/A | Partial |
| C8 states | Partial (loading ok, no error.tsx) | Partial | Partial | Partial (spinner only) | Partial |
| C9 message type | Pass | Fail (top banner) | Fail (toasts) | Fail (toasts) | Pass |
| C10 confirm/undo | Fail (native confirm, delete) | Fail (role on change) | N/A | Fail (POS replace) | Fail |
| C12 buttons | Fail (danger beside export) | Pass | Fail (two primaries, gold) | Partial | Pass |
| D5 where am I / h1 | Fail | Fail | Pass | Pass | Pass |
| D7 reachability | Pass | Pass | Pass | **Fail (orphan)** | Pass |
| D9 notification prefs | **Fail (absent)** | — | — | — | — |
| E3 isolation | Pass | **Fail** | Pass | Partial (`dir=auto` input) | Pass |
| E6 tracking | Partial (referral) | Pass | Pass | Pass | **Fail** |
| E8 dates | Pass | Pass | **Fail (MM/DD)** | Pass | Pass |
| F1 statement | **Fail** | — | — | — | — |
| F3 focus | Partial | Fail (`/60`) | Fail (`/60`) | Fail (`/60`) | Partial |
| F5 structure | Fail (no h1) | Fail (no h1) | Pass | Pass | Pass |
| H7 history | **Fail (no audit)** | Partial (audited, not visible) | Fail (no log) | Fail (no log) | Partial |

**Pilot bar:** not met. There are 3 P0 findings (admin-01, admin-02, admin-03), and S1 issues sit on the bookkeeper's primary flow (admin-04, admin-05, admin-06).
