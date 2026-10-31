# F-shell-settings: in-app copy focus audit (shell, settings, team, integrations, admin, auth, onboarding)

Release source: `rw-release` (read-only, HEAD `b5b27bcd`). Lab: http://localhost:3351 (build ab9908c4), tenant "כפר הזיתים", locale he. Captured 31.10.2026. Phone 390×844 for manager, receiver and chef; desktop 1440×900 for owner and bookkeeper; signed-out auth screens on phone (login also on desktop).
Scope: the shell (nav, WorkerStatusBanner, offline chip, re-auth sheet, branch-switch toasts, search, 403, 404, error pages, cookie consent), /dashboard/settings (incl. the referral card), /dashboard/team, /dashboard/integrations, /admin, /login and the sign-in family (check-email, 2FA, reset, set-password), /invite/accept and /onboarding. Catalogs: `common`, `nav`, `components` (+`ds`), `settings`, `team`, `integrations`, `admin`, `auth`, `onboarding`, `growth.referral` (in-app part only; `growth.pricing`/`growth.compare` are marketing), `marketing.cookie` (the consent banner renders inside the app), the inline strings of `app/global-error.tsx`, and the server prose in `packages/api/src/routers/{team,onboarding,admin,growth,dsr,settings}.ts`.

**Inventory:** 194 explanatory strings: 76 SHORTEN, 26 MERGE, 16 CUT (6 of them dead keys that render nowhere), 2 FOLD, 74 KEEP (incl. 5 confirmations, 3 legal, 3 a11y names). 77 rows are pilot-critical.
Source-level words: **1619 → 1095** (−524). Rendered strings only: **1578 → 1095**. Pilot-critical rows: 671 → 470.
Captures: 51 full-page JPEGs, **8399 visible words**, of which 4705 are explanatory. **≈5696 after** (−2703). Six of the capture states (the "עוד" sheet, account menu, search ×2, offline, re-auth) sit over the settings page and repeat its text. Without them: 38 captures, 3883 visible, 1924 explanatory, ≈2808 after (−1075).

JSON: `docs/ux/wave2/copy-focus/inventory-F-shell-settings.json` · scripts, captured innerText, per-screen hits: `docs/ux/wave2/copy-focus/work-F-shell-settings/`

How the numbers were made:
- **Visible words** are Hebrew and Latin tokens in `document.body.innerText`: letter-led tokens, so numbers and ₪ amounts are excluded. The count includes the header, sidebar, sr-only text and `<option>` texts. **Explanatory** is the inventory strings matched in that capture (placeholders as wildcards, a11y names not counted), times their occurrences. **After** is visible − explanatory + the rewritten strings: CUT = 0, SHORTEN and MERGE = the proposal, FOLD = visible line + toggle label (folded text is collapsed).
- **Nothing was written to the lab DB.** No mutation was sent. The re-auth sheet was produced inside the browser context by answering the search read with `UNAUTHORIZED` and `/api/auth/session` with `{}`. The procurement preview is a read (`integrations.procurementPreview`). 2FA enrolment was not started, because it writes a pending secret.
- **The worker banner is in this area** (`nav.worker.*`), so it is counted, not treated as lab noise. It shows on all 30 dashboard captures because the lab worker is down: 17 words each, 8 after. In production it shows only while the job runner's heartbeat is older than 5 minutes.
- **Lab findings (build ab9908c4; the source wins):** `/login` while signed in returns **500** and renders the root error page (capture `login-signedin`). Source renders "אתם כבר מחוברים כ-…" there, so check this on the release build. /dashboard/settings has **no h1**; the page title lives only in the breadcrumb. The owner is a multi-branch member (3 branches), so the branch chip shows.
- **Not reachable in the lab; inventoried from source:** /onboarding (every demo user has a restaurant, so it redirects), /login/2fa (needs a pending-2FA session), 2FA enrol and recovery codes, the error boundary and global-error, the branch-switch toasts, team invite results, the DSR flow, POS import results and errors, the admin empty and no-subscription states, the receiver queued-photo note on /login.

## (a) Per-screen counts

| screen | role | viewport | visible words | explanatory words | est. words after | screenshot |
|---|---|---|---:|---:|---:|---|
| /dashboard/settings | owner | 1440x900 | 403 | 225 | 274 (-129) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--owner--desktop.jpg` |
| /dashboard/settings | manager | 390x844 | 361 | 249 | 216 (-145) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--manager--phone.jpg` |
| /dashboard/settings | bookkeeper | 1440x900 | 370 | 235 | 233 (-137) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--bookkeeper--desktop.jpg` |
| /dashboard/settings | receiver | 390x844 | 158 | 114 | 76 (-82) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--receiver--phone.jpg` |
| /dashboard/settings | chef | 390x844 | 156 | 114 | 74 (-82) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--settings--chef--phone.jpg` |
| /dashboard/team | owner | 1440x900 | 227 | 46 | 194 (-33) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--team--owner--desktop.jpg` |
| /dashboard/team | manager | 390x844 | 114 | 43 | 83 (-31) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--team--manager--phone.jpg` |
| /dashboard/integrations | owner | 1440x900 | 220 | 88 | 174 (-46) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--integrations--owner--desktop.jpg` |
| /dashboard/integrations | manager | 390x844 | 98 | 61 | 63 (-35) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--integrations--manager--phone.jpg` |
| /dashboard/integrations | bookkeeper | 1440x900 | 144 | 61 | 111 (-33) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--integrations--bookkeeper--desktop.jpg` |
| /dashboard/integrations (procurement preview open) | owner | 1440x900 | 250 | 110 | 195 (-55) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--integrations-open--owner--desktop.jpg` |
| /dashboard/integrations (procurement preview open) | manager | 390x844 | 128 | 83 | 84 (-44) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--integrations-open--manager--phone.jpg` |
| /admin | owner | 1440x900 | 45 | 0 | 45 (+0) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--admin--owner--desktop.jpg` |
| /admin/leads (empty) | owner | 1440x900 | 36 | 7 | 36 (+0) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--admin-leads--owner--desktop.jpg` |
| /admin/restaurants/[id] | owner | 1440x900 | 82 | 0 | 82 (+0) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--admin-restaurant--owner--desktop.jpg` |
| shell 403 (in-route) | bookkeeper | 1440x900 | 101 | 34 | 87 (-14) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--forbidden--bookkeeper--desktop.jpg` |
| shell 403 (in-route) | receiver | 390x844 | 72 | 34 | 58 (-14) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--forbidden--receiver--phone.jpg` |
| shell 403 (in-route) | chef | 390x844 | 67 | 34 | 53 (-14) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--forbidden--chef--phone.jpg` |
| root 404 (/dashboard/nope-x) | owner | 1440x900 | 18 | 13 | 10 (-8) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--notfound-root--owner--desktop.jpg` |
| root 404 (/dashboard/nope-x) | receiver | 390x844 | 18 | 13 | 10 (-8) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--notfound-root--receiver--phone.jpg` |
| shell 404 (notFound(): zero-uuid supplier / order) | owner | 1440x900 | 103 | 27 | 92 (-11) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--notfound-shell--owner--desktop.jpg` |
| shell 404 (notFound(): zero-uuid supplier / order) | manager | 390x844 | 48 | 27 | 37 (-11) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--notfound-shell--manager--phone.jpg` |
| "עוד" sheet, over settings | manager | 390x844 | 420 | 249 | 275 (-145) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--more-sheet--manager--phone.jpg` |
| "עוד" sheet, over settings | receiver | 390x844 | 172 | 114 | 90 (-82) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--more-sheet--receiver--phone.jpg` |
| "עוד" sheet, over settings | chef | 390x844 | 170 | 114 | 88 (-82) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--more-sheet--chef--phone.jpg` |
| account menu, over settings | owner | 1440x900 | 413 | 225 | 284 (-129) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--account-menu--owner--desktop.jpg` |
| account menu, over settings | bookkeeper | 1440x900 | 379 | 235 | 242 (-137) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--account-menu--bookkeeper--desktop.jpg` |
| search open, over settings | owner | 1440x900 | 417 | 231 | 288 (-129) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--search--owner--desktop.jpg` |
| search open, over settings | manager | 390x844 | 365 | 249 | 220 (-145) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--search--manager--phone.jpg` |
| search with results, over settings | owner | 1440x900 | 413 | 231 | 284 (-129) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--search-results--owner--desktop.jpg` |
| offline chip, over settings | owner | 1440x900 | 408 | 230 | 279 (-129) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--offline--owner--desktop.jpg` |
| offline chip, over settings | manager | 390x844 | 366 | 254 | 221 (-145) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--offline--manager--phone.jpg` |
| offline chip, over settings | receiver | 390x844 | 163 | 119 | 81 (-82) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--offline--receiver--phone.jpg` |
| re-auth sheet, over settings (401 stub) | owner | 1440x900 | 436 | 253 | 297 (-139) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--reauth--owner--desktop.jpg` |
| re-auth sheet, over settings (401 stub) | manager | 390x844 | 394 | 277 | 239 (-155) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--reauth--manager--phone.jpg` |
| /set-password (change) | owner | 1440x900 | 32 | 11 | 26 (-6) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--set-password--owner--desktop.jpg` |
| /set-password (change) | receiver | 390x844 | 32 | 11 | 26 (-6) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--set-password--receiver--phone.jpg` |
| /invite/accept (not found) | owner | 1440x900 | 27 | 13 | 23 (-4) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--invite-notfound--owner--desktop.jpg` |
| /invite/accept (not found) | receiver | 390x844 | 27 | 13 | 23 (-4) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--invite-notfound--receiver--phone.jpg` |
| /login signed in → root error page (lab 500) | owner | 1440x900 | 23 | 17 | 15 (-8) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-signedin--owner--desktop.jpg` |
| /login | anon | 1440x900 | 47 | 19 | 35 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login--anon--desktop.jpg` |
| /login | anon | 390x844 | 47 | 19 | 35 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login--anon--phone.jpg` |
| /login + cookie banner | anon | 1440x900 | 60 | 26 | 48 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-consent--anon--desktop.jpg` |
| /login + cookie banner | anon | 390x844 | 60 | 26 | 48 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-consent--anon--phone.jpg` |
| /login?error=CredentialsSignin | anon | 390x844 | 51 | 23 | 39 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-error--anon--phone.jpg` |
| /login?sent=1 | anon | 390x844 | 55 | 27 | 43 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-sent--anon--phone.jpg` |
| /login?email= (invited) | anon | 390x844 | 56 | 28 | 39 (-17) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--login-invited--anon--phone.jpg` |
| /login/check-email | anon | 390x844 | 40 | 21 | 33 (-7) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--check-email--anon--phone.jpg` |
| /reset | anon | 390x844 | 30 | 12 | 23 (-7) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--reset--anon--phone.jpg` |
| /reset?sent=1 | anon | 390x844 | 32 | 16 | 32 (+0) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--reset-sent--anon--phone.jpg` |
| /reset?token=&error=token | anon | 390x844 | 45 | 24 | 33 (-12) | `docs/ux/wave2/copy-focus/shots/F-shell-settings--reset-choose--anon--phone.jpg` |
| **total (51 captures)** | | | **8399** | **4705** | **5696** | |

## (b) Repetition: concepts explained in more than one place

Every place is listed. "→" gives the single wording each place shows after the change. Keys outside this area are marked with their package.

1. **concept.genericFail — "it failed, try again"**: 7 keys, 5 wordings. `components.errors.generic` "הפעולה נכשלה. נסו שוב." is repeated verbatim in `auth.serverErrors.generic`, `admin.generic` and `settings.dsr.failed`. Other wordings: `growth.referral.errors.generic` "משהו השתבש. נסו שוב.", `auth.setPassword.errors.generic` "אירעה שגיאה. נסו שוב.", `auth.login.errors.generic` "אירעה שגיאה בהתחברות. נסו שוב." → one key, `components.errors.generic`. Login keeps its own sign-in wording.
2. **concept.errorRetry — "unexpected error, try again"**: `common.errorPage.body` (root error page), `common.shell.error.body` (shell error boundary), `app/global-error.tsx:77` (inline). → "נסו שוב. אם זה חוזר, שלחו לנו את הקוד." (key `common.shell.error.body`; global-error imports the plain he object).
3. **concept.notFound**: `common.notFound.body` (root 404, every unmatched /dashboard URL), `common.shell.notFound.body` (shell 404), `common.shell.notFound.otherBranch` (dead), `components.errors.notFound`, `auth.serverErrors.notFound`. → page: "הקישור שגוי, הדף נמחק, או שהוא בסניף אחר." (root: "הקישור שגוי או שהדף הוסר."); item: "הפריט לא נמצא — ייתכן שנמחק." (one key).
4. **concept.offline — no connection**: `common.shell.offline.chip`, `common.shell.error.offline`, `components.errors.network` ("אין חיבור **לשרת**") vs C-receiving `receiving.errors.network` ("אין חיבור **לרשת**"), `common.shell.offline.action` (dead). → the chip phrase "כשהרשת תחזור" in both shell texts; one network error wording, "אין חיבור לרשת. בדקו את החיבור ונסו שוב.".
5. **concept.sessionExpired**: `common.shell.session.body` (re-auth sheet), `common.shell.session.notSent` (failed control, shown with the sheet), `auth.serverErrors.unauthorized`, `auth.serverErrors.accountGone` + server prose `onboarding.ts:49` (masculine singular); C-receiving: `receivingDelivery.count.sessionExpired`, `receivingDelivery.pwa.signInToUpload`. → sheet: "התחברו שוב — העבודה שלכם נשמרה." (same as C); control: "לא נשלח · התחברו ונסו שוב."
6. **concept.magicLink — sign in with a link by mail (3 names: קישור כניסה / קישור התחברות / קישור-קסם)**: `auth.login.subtitle`, `auth.login.magicSubmit`, `common.shell.session.magicLink`, `auth.signin.magicFallback`, `auth.signin.newHere`, `auth.setPassword.subtitleSet`, `settings.account.passwordSet` / `passwordNone` ("קישור-קסם"), `settings.sections.securitySubtitle` ("קישור-הקסם"); "valid 24 h" twice: `auth.checkEmail.body` + `auth.mail.sentTo`. → one name, "קישור כניסה"; one "sent" line, `auth.mail.sentTo` ("שלחנו קישור כניסה ל-{email}, תקף ל-24 שעות.").
7. **concept.devicesSignOut**: `settings.account.devicesHint` + `settings.account.devicesConfirm` (same click, said twice), `auth.reset.chooseSubtitle`, `auth.setPassword.subtitleChange`, `auth.login.resetDone` (said before and after the reset). → said once, before the action: the confirmation, and "כל המכשירים יתנתקו אחרי האיפוס." / "שאר המכשירים יתנתקו."
8. **concept.twoFactor**: `settings.sections.securitySubtitle` and `settings.twoFactor.disabledBody` (one above the other), `settings.twoFactor.enabledBody`, `auth.twoFactor.subtitle`. → one line on the card: "מומלץ: קוד מאפליקציית אימות בכל כניסה."
9. **concept.recoveryCodes**: `settings.twoFactor.codesIntro` ("כל קוד תקף לשימוש יחיד…") and `auth.recovery.subtitle` ("כל קוד עובד פעם אחת"). → one phrase, "כל קוד עובד פעם אחת" (folded in settings, visible on the 2FA page).
10. **concept.vatAffectsLeak**: `settings.sections.profileSubtitle` and `settings.profile.cardSubtitle`: the same screen, back to back, under the same title "פרטי המסעדה" said twice. → one line: "מע״מ ואזור הזמן משפיעים על חישוב הדליפה. ודאו שהם נכונים."
11. **concept.readOnly — only the owner edits**: `settings.readOnly.profile`, `settings.readOnly.matching`, `integrations.accounting.mapping.readOnly`, `team.managerNote`; D-procurement: `contracts.readOnly`, `products.names.readOnly`, `products.form.readOnly` (canonical "צפייה בלבד"). → new shared key `explain.ownerEditsOnly` = "צפייה בלבד · עריכה לבעלים" (team keeps "הזמנות ותפקידים — לבעלים בלבד.").
12. **concept.lastOwner**: `auth.serverErrors.lastOwner` ("חייב להישאר לפחות בעלים אחד."), `auth.serverErrors.adminLastOwner` = `admin.roles.lastOwner` (identical text, two keys), `auth.serverErrors.soleOwner`, the tail of `settings.dsr.note`. → "אי־אפשר להוריד את הבעלים האחרון. קדמו קודם בעלים נוסף." (one key); owner transfer said only in the soleOwner error.
13. **concept.passwordPolicy**: `auth.reset.policy` = `auth.setPassword.errors.policy` and `auth.reset.mismatch` = `auth.setPassword.errors.mismatch` (identical pairs), plus `auth.setPassword.hint` shown on both forms. → one key each, `auth.setPassword.errors.*`.
14. **concept.linkExpired**: `auth.login.errors.verification`, `auth.reset.token`, `auth.resetFlow.sentTo` ("תקף לזמן קצר"), `auth.inviteState.expiredBody*`, `auth.serverErrors.inviteExpired`. → "הקישור פג או כבר נוצל." (+ "בקשו קישור חדש." where no link follows).
15. **concept.rateLimit**: `components.errors.tooMany`, `auth.login.errors.rate`, `auth.reset.rate`, `team.invite.rateLimited`, `common.shell.session.wrong`, `auth.signin.lockoutHint`, `auth.login.errors.emailSignin`. → opener "יותר מדי ניסיונות/הזמנות…" + when to retry; `login.errors.rate` merges into `components.errors.tooMany`.
16. **concept.forbidden**: `components.errors.forbidden` = `auth.serverErrors.forbidden` (identical); `common.shell.forbidden.requestBody` restates for the requester what the owner can do. → one key; requestBody "נפתח לכם הודעה מוכנה עם הקישור."
17. **concept.invalidInput**: `components.errors.validation` vs `auth.serverErrors.invalidInput`. → "חלק מהשדות אינם תקינים. בדקו ונסו שוב."
18. **concept.flagThreshold**: `settings.matching.fields.pricePercentHint` and `priceAbsoluteHint`: adjacent fields, same meaning, both say "חריגה/הפרש". → new key `settings.matching.fields.belowNotFlagged` = "פער קטן מזה לא מסומן."
19. **concept.percentInput**: "(5 = 5%)" in `settings.matching.tolerancesSubtitle` and `settings.matching.ocrSubtitle`, and every label already ends in "(%)". → once, in tolerancesSubtitle: "5 = 5%. שדה ריק = ללא שינוי."
20. **concept.realConnect**: `integrations.procurement.body` (2nd sentence) and `integrations.procurement.activate` (points to an internal ops doc). → once, under the preview: "חיבור חשבון אמיתי דורש פרטי גישה מהבעלים."
21. **concept.invite / appLanguage (team page)**: `team.subtitle` + `team.managerNote` (a manager reads both, and they contradict), `team.invite.subtitle`, `settings.account.languageHint`; `auth.login.invitedHint`, `onboarding.invitedNote`. → subtitle cut; managerNote "הזמנות ותפקידים — לבעלים בלבד."; invite advice folded.
22. **concept.entitlement**: `auth.serverErrors.entitlementRequired`, `auth.serverErrors.quotaExceeded`; A-owner-money: `components.entitlement.body` / `compactBody` ("זמינה במסלולים בתשלום"). → "לא כלול בתוכנית שלכם. שדרגו כדי להשתמש." (A keeps the upsell card).

## (c) The 10 highest-value changes (before → after)

1. **Worker banner: every dashboard page, every role (pilot)** (17 → 8 words)
   - לפני: מנוע העיבוד לא זמין כרגע. חשבוניות שתעלו יישמרו ויעברו OCR והתאמה ברגע שהוא יחזור. הבעלים קיבל התראה.
   - אחרי: העיבוד מתעכב. חשבוניות שתעלו יישמרו ויעובדו אחר כך.
   - It also drops a false claim: the alert goes to ops (WORKER_ALERT_EMAILS / PLATFORM_ADMIN_EMAILS), not the owner.
2. **Settings › my account: all roles, ~70% of the receiver's and chef's settings page** (39 → 7 words)
   - לפני: שפת האפליקציה, סיסמה וניתוק מכשירים — הגדרות אישיות שלכם בלבד. · השפה נשמרת בחשבון שלכם במסעדה הזו ומוחלת גם במכשירים חדשים. · יש לכם סיסמה — אפשר להתחבר איתה או עם קישור-קסם. · ניתוק מכל המכשירים מבטל מיידית כל התחברות פעילה — גם במכשיר הזה.
   - אחרי: — · נשמרת לחשבון שלכם, בכל מכשיר. · סיסמה מוגדרת. · — (the confirmation "…כולל המכשיר הזה?" stays)
3. **Settings › restaurant details: owner, manager, bookkeeper** (26 → 10 words)
   - לפני: שם, ח״פ, שיעור מע״מ ואזור זמן — נושאי משקל לחישוב הדליפה ולגבולות היום. · שיעור המע״מ ואזור הזמן משפיעים ישירות על חישוב הדליפה וגבולות היום — ודאו שהם נכונים.
   - אחרי: מע״מ ואזור הזמן משפיעים על חישוב הדליפה. ודאו שהם נכונים.
   - Two near-identical lines on one screen become one.
4. **Settings › privacy: all roles** (36 → 11 words)
   - לפני: ייצוא הנתונים האישיים שלכם או מחיקת החשבון — מימוש זכויות נושא המידע. · הייצוא כולל את פרטי החשבון, החברויות והפעילות שלכם. אם אתם הבעלים היחידים של מסעדה עם חברים נוספים, יש להעביר תחילה את הבעלות לפני מחיקת החשבון.
   - אחרי: מימוש זכויות נושא המידע. · הייצוא כולל את החשבון, החברויות והפעילות שלכם.
   - The owner-transfer rule is said once, by the server error at the moment of deletion ("העבירו את הבעלות על המסעדה לפני מחיקת החשבון."). The legal reference stays.
5. **Team › owner invite: pilot set-up, week 1** (29 → 5 words)
   - לפני: הזמינו עובדים, הגדירו תפקידים ושפת אפליקציה, ונהלו את הגישה למסעדה. · מנהל משמרת שמקבל סחורה — בחרו "מקבל סחורה". עובד שלא דובר עברית — בחרו שפה English. נשלח קישור הצטרפות לכתובת המייל.
   - אחרי: — · נשלח קישור הצטרפות למייל. [פרטים ⌄] → (folded) מנהל משמרת שמקבל סחורה: בחרו "מקבל סחורה". עובד שלא דובר עברית: בחרו English.
6. **Team › manager view** (26 → 4 words)
   - לפני: הזמינו עובדים, הגדירו תפקידים ושפת אפליקציה, ונהלו את הגישה למסעדה. · כמנהל/ת אפשר לראות את הצוות ולקבוע לכל עובד את שפת האפליקציה. הזמנות ותפקידים — בידי הבעלים.
   - אחרי: הזמנות ותפקידים — לבעלים בלבד.
   - The subtitle told the manager to do things they cannot do; the note existed only to correct it.
7. **Login: every pilot worker's first screen** (19 → 4 words)
   - לפני: התחברו עם הסיסמה, או קבלו קישור כניסה למייל (בלי סיסמה). · ההזמנה נשלחה לכתובת הזו — התחברו איתה כדי לקבל גישה.
   - אחרי: — (the form shows both ways) · ההזמנה נשלחה לכתובת הזו.
8. **Settings › 2FA: all roles** (22 → 6 words)
   - לפני: אימות דו-שלבי מוסיף שכבת הגנה שאי-אפשר לעקוף גם דרך קישור-הקסם למייל. · מומלץ להפעיל — נדרש קוד חד-פעמי מאפליקציית אימות בנוסף לסיסמה או לקישור.
   - אחרי: מומלץ: קוד מאפליקציית אימות בכל כניסה.
9. **Settings › matching thresholds: 7 lines, 4 with the retired term "חריגה"** (62 → 43 words)
   - לפני: ספי הסבילות והאישורים שמכתיבים מתי חריגה מסומנת כחוסמת, נכנסת לתור או מאושרת אוטומטית. · חריגת מחיר שמתחתיה לא מסומן. · הפרש מחיר מוחלט שמתחתיו לא מסומן. · חריגה מעל סף זה מסומנת כחוסמת (מחליטים לפני התשלום). · …
   - אחרי: מתי פער נחסם, נכנס לתור או מאושר לבד. · פער קטן מזה לא מסומן. (one key, both fields) · פער מעל הסף נחסם עד החלטה לפני תשלום. · מאיזה סכום פער עובר לתור האישורים. · …
10. **Re-auth sheet: any role, mid-task (pilot receiver flow)** (20 → 10 words)
   - לפני: התחברו שוב — העבודה שלכם נשמרה. פעולה שלא נשלחה מחכה ללחיצה נוספת שלכם. · הפעולה לא נשלחה · ההתחברות פגה. התחברו ונסו שוב.
   - אחרי: התחברו שוב — העבודה שלכם נשמרה. · לא נשלח · התחברו ונסו שוב.
   - Same sheet wording as C-receiving.

## Also found (not explanatory copy: fix in the same PR, no verdict)

- **Retired terms in area catalogs, rendered on the home activity feed (A-owner-money screen).** `components.activity.types.discrepancy_approved` "חריגה אושרה", `discrepancy_rejected` "חריגה נדחתה", `activity.discrepancyOne` "חריגה אחת", `activity.discrepancies` "{count} חריגות", `activity.toReviewOne` / `toReview` "… חריגות לבדיקה" → פער / פערים. `activity.consolidatedReceivedNumbered` "חשבונית ריכוז {number} התקבלה" → "חשבונית מרכזת {number} התקבלה". `activityText.ts` parses the stored server detail by its old Hebrew, which is independent of these catalog values; `ops-components.test.ts` and `plural.test.ts` use "חריגה" only as input.
- **One thing, several names.** h1 "אינטגרציות" vs nav and 403 screen name "חיבורים". The optional marker appears three ways: "(רשות)" `components.ds.field.optional`, "(לא חובה)" `onboarding.optional`, "אופציונלי" `common.states.optional`. The switch-account button appears four ways: `auth.signin.switchUser`, `auth.twoFactor.switchAccount`, `auth.inviteState.otherAccount`, `common.shell.session.otherUserLink`. The magic link has three names (above). Admin: "הרחבות (override)".
- **Typography.** Team member row: "רון אלמוג(את/ה)" has no space before "(את/ה)" (`team.members.you` is appended with no separator).
- **Structure.** /dashboard/settings has no h1 (the title lives only in the breadcrumb). The profile card repeats its section title "פרטי המסעדה" as an h3. `onboarding.invitedNote` renders after the submit button; it belongs above the form.
- **Non-copy bugs found while auditing.** (1) The worker banner claims "הבעלים קיבל התראה" unconditionally (see top-1). (2) `admin.ts:251` throws uncoded English, so a Hebrew UI shows "אחד הערכים שהוזנו אינו תקין" for "no subscription" (row `server:admin.noSubscription`). (3) `growth.ts:184` reuses `growth.referralInvalid` for "first month only", so a valid late code reads "הקוד לא נמצא" (row `server:growth.referralTooLate`). (4) Lab build ab9908c4: /login while signed in → 500 (verify on the release build).

## Implementation notes for the copy PR

- **Receiver-language overlays.** `nav`, `components`, `common.shell.{offline,session,forbidden,notFound,error}` and `auth.{login,checkEmail,twoFactor,signin}` must be complete in ar/ru/th/ti (`apps/web/lib/__tests__/receiver-langs.test.ts`). Every SHORTEN, MERGE or CUT there needs the same change in `apps/web/lib/i18n/messages/receiverLangs/overlays/*` (machine translation, pending native review, as W1-06 did). The 6 dead keys are removed from the overlays too.
- **`auth.serverErrors` doubles as a lookup table.** `localizeServerError`'s fallback (`BY_HEBREW_MESSAGE`) maps a server message to a key by exact Hebrew equality. Every S4 error now carries an appCode, so the primary path is unaffected. But when a he text changes (`lastOwner`, `adminLastOwner`, `notFound`, `invalidInput`, `soleOwner`, `inviteWrongEmail`), either change the matching server prose in `packages/api/src/routers/{team,admin,dsr}.ts` in the same PR or retire the fallback. `apps/web/lib/__tests__/serverErrors.test.ts` asserts the current Hebrew at :6, :16 and :53.
- **New or canonical keys.** New: `explain.ownerEditsOnly` (settings ×2 + integrations) and `settings.matching.fields.belowNotFlagged`. Canonical: `components.errors.{generic,forbidden,notFound,validation,tooMany}`, `common.shell.error.body`, `common.shell.notFound.body`, `auth.mail.sentTo`, `auth.reset.token`, `auth.setPassword.errors.{policy,mismatch}`, `auth.serverErrors.lastOwner`, `auth.recovery.subtitle`, `integrations.procurement.activate`.
- **Folds (2).** `settings.twoFactor.codesIntro` and `team.invite.subtitle`, both "פרטים" and inline via `<Explain>` (MECHANISM §2). This area is settings and sign-in, where cutting and shortening carry most of the saving. No fold goes into the re-auth sheet, the 403 page or a confirmation.
- **Tests to touch (7 files):** `apps/web/e2e/W1-04.spec.ts`, `apps/web/e2e/W1-09.spec.ts`, `apps/web/e2e/demo-path.spec.ts`, `apps/web/lib/__tests__/receiver-langs.test.ts`, `apps/web/lib/__tests__/serverErrors.test.ts`, `apps/web/lib/net/__tests__/resilience.test.ts`, `packages/api/src/__tests__/app-error-codes.test.ts`. Per-row lists are in the JSON `testRefs`. A KEEP row that a test reads today is listed under `testRefsInfo`.
- **Keys shared with other areas.** `common.shell.session.body` (same proposal as C), `common.shell.offline.chip` (KEEP, as C), `components.errors.network` (aligned to C's `receiving.errors.network`), `settings/integrations` read-only (aligned to D's "צפייה בלבד"). Not re-inventoried here: `integrations.accounting.*` export toasts (B-ap, /dashboard/exports), `components.entitlement.*` and `components.activity.*` (A-owner-money), `auth.serverErrors.invoiceNumberTaken` (B-ap).

