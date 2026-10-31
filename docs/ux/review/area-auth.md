# Area review: Login, password, invite, onboarding, supplier portal (`auth`)

**Reviewer:** UX review team, area `auth` · **Date:** 2026-10-25 · **Tree:** `main` @ 8fef118c (worktree `scratchpad/ux/wt`)
**Routes:** `/login` · `/login/check-email` · `/login/2fa` · `/reset` (request + `?token=`) · `/set-password` · `/invite/accept` · `/onboarding` · `/s/[token]` (supplier portal)
**Archetypes:** Form (all auth routes), Public (`/s/[token]`). Rubric groups applied: B, C, E, F, J (fully); G, D, H, I (where the pattern appears).

## Scores (0–10, against world-class)

| Lens | Score | One-line reason |
|---|---|---|
| Mobile | **4.0** | The card looks clean on a phone. But back-door staff only get email + password, with a 1-day default session, a doubled email field and no PIN or passkey. Landing on `/login` **wipes the receiver's offline invoice photos**. |
| Desktop | **5.0** | The centred card is tidy and calm. It has no brand, no way back to the site and no signup explanation. The 1440 canvas is empty. That is acceptable for auth, but nothing here is "insane". |
| Functionality | **3.5** | Onboarding has no path to the first ₪: it asks 2 fields, then shows a green ₪0. An invite costs two emails. The supplier portal's primary button **silently discards the supplier's edits**. The leak-check claim loses its context. |

**Pilot bar:** fails, with 2 P0s (lost field photos; lost supplier answers) and P1s on primary flows (invite join, first value).
**World-class bar:** far off. The benchmark bar here is Linear/Slack email-code sign-in, Toast/Square staff passcodes, the Ramp/Stripe setup checklist and the Choco supplier acknowledgment.

### Capture notes (read before the screenshots)
- `/login/2fa`, `/set-password`, `/invite/accept` and `/onboarding` **redirect to `/login`** for an anonymous crawler (`crawl-results.json` `finalPath: "/login"`). Their screenshots are copies of the login page. Those four pages were reviewed **from code**.
- `/s/invalid-demo-token` is a real **404** (unknown token). The working portal was reviewed from `app/s/[token]/page.tsx` and `answer-form.tsx`.
- axe-core reported **0 violations** on every capture in this area. There was no horizontal overflow, and load times were 1.2–1.4 s. Small targets: login 4 (phone) / 3 (en), reset 2, check-email 2.
- Cookie bar: it is a lab first-visit artifact. But on phones it occupies ≈95 px at the bottom of every auth page and of the supplier portal, and that **is** judged (auth-31).

---

## 1. What each page really does (code walk)

| Route | Gate | States in code | Notes |
|---|---|---|---|
| `/login` (`app/login/page.tsx`) | public; no check for an existing session | default · `?error=` (5 codes → 1 uniform credential msg) · `?sent` / `?reset` / `?signedOut` banners · invite mode (`?email=` locks both email inputs read-only) | Password form is PRIMARY; magic-link form (2nd email input) is SECONDARY. Mounts `PwaQueueReset` (L112). Six-language picker (L113-121). No loading state on submit. |
| `/login/check-email` | public | single static state | No address, no resend, no timer, no language control. Dev hint only outside prod. |
| `/login/2fa` | session with `twoFactorPending` | default · `?error` (uniform) | One input `inputMode="numeric"` for both TOTP **and** alphanumeric recovery codes. No "trust this device". |
| `/reset` | public | request · `?sent` · `?error=rate&wait=` · token mode (`mismatch`/`policy`/`token`) | After the reset, the user is sent back to `/login?reset=1` to sign in manually. |
| `/set-password` | full session | set vs change (current pwd) · `?changed` · 4 errors | The only place the min-length hint shows up front. The back link goes to settings. |
| `/invite/accept?token=` | session (middleware bounces to `/login?callbackUrl=` **without** `email=`) | success = silent redirect via `/api/session/refresh?next=/dashboard` · error card | The error card offers only "חזרה לדשבורד". For a user with no membership, that leads to `/onboarding`. |
| `/onboarding` | session, no memberships | form · client error · pending | 2 fields (name, optional ח״פ). Ignores `callbackUrl`. Pushes to `/dashboard`. |
| `/s/[token]` | token (72 h), flag `supplierConfirm`, IP rate limit | rate-limited shell · expired shell · NOT_FOUND → app 404 · already answered · form · sending · done · error | One answer per link. The "as-is" primary sends `lines: []`. A 409 is shown as a success. |

## 2. Primary tasks walked end to end

### J-1 · Receiver joins the team (owner invites "Somchai K.", receiver)
1. The owner fills the email-only invite on `/dashboard/team` (`dashboard_team__owner__phone-he.png`). Language options are only device/he/en, even though login supports 6.
2. Somchai opens the email and taps **הצטרפות לצוות** (tap 1). He lands on `/login?callbackUrl=/invite/accept?token=…&email=…`. Both email fields are locked, and the **primary** asks for a password he does not have. The hint says "התחברו איתה" but never says "use the link button".
3. He taps the **secondary** "שלחו לי קישור התחברות" (tap 2) and lands on `/login/check-email`, which shows no address and no resend.
4. He switches to the mail app (app switch 1), opens the 2nd email (tap 3) and taps **כניסה לחשבון** (tap 4). The link opens in the mail app's in-app browser or in Safari, **not in an installed PWA**: iOS gives standalone PWAs a separate cookie jar.
5. `/invite/accept` → session refresh → `/dashboard`. There is no welcome, no "set a password or PIN", and no install coach.
6. **Next shift:** the session lasts 30 days for magic-link logins, but he never set a password. On another device, or after a sign-out, the whole 2-email dance repeats.
**Total: 4 taps, 2 emails, 1–2 app switches, and a dead-end primary.** Slack, Notion and 7shifts need 1 message and 1 screen.

### J-2 · New owner, self-serve, from the leak check
1. Leak-check result → "start a trial with these results" → `/leak-check/claim?t=…`.
2. No session → `/login` → magic link (retype email) → check email → click.
3. Back at the claim → no restaurant → `/onboarding?callbackUrl=/leak-check/claim?t=…`.
4. Onboarding **ignores `callbackUrl`**. After "יצירת מסעדה והמשך" the owner lands on `/dashboard` and **the leak-check claim is lost**.
5. The dashboard shows a big **green ₪0**, "עדיין אין חשבוניות החודש", "יעד: 1.5% מההוצאה" and the full control-room chrome. There is no checklist and no sample.
**Time to first ₪: unbounded.** The product's own first ₪ (the leak-check result) is thrown away at the seam.

### J-3 · Back-door login on a phone (receiver with a password)
1. Open the app, type the email, type the password.
2. "זכור אותי" is **unchecked by default**, so the session dies after 24 h, or when the mobile browser drops the session cookie.
3. If the password is wrong, the redirect **clears the typed email**, so the receiver retypes both on a phone with the driver waiting.
4. If the earlier session expired while photos were queued offline, simply landing on `/login` **deletes those queued invoice photos** (`PwaQueueReset`).

### J-4 · Supplier answers an order from WhatsApp (`/s/[token]`)
- **Confirm as is:** scroll to the bottom → 1 tap. Fine.
- **Mark 1 shortage:** find the line → edit the qty → scroll → the eye lands on the big green **"אישור ההזמנה כפי שהיא"** (primary), which is the natural tap → **the shortage is silently discarded** (`send(true)` sends `lines: []`). The supplier is told "ההזמנה אושרה כפי שהיא". The restaurant then expects the full quantity, and the dock flags a shortage everyone already knew about.
- A second person at the supplier opens the same link and sends changes → 409 → shown as **"תודה! … המסעדה תראה את החוסרים"**, but nothing was recorded.
- An old or revoked link from WhatsApp → the generic app 404 with **"חזרה לסקירה"** → `/dashboard` → `/login`. That is a dead end for a supplier with no account.

---

## 3. Findings (most severe first)

Severity: **P0** blocks or misleads a core task, or loses data, money or trust. **P1** is major friction or below the benchmark. **P2** is polish. **P3** is a nit. The rubric IDs are given in brackets.

### P0

**auth-01 · Landing on `/login` deletes the receiver's offline invoice photos** [G7, rule 8] · mobile · functional
- *Evidence:* `apps/web/app/login/page.tsx:112` mounts `<PwaQueueReset/>`. `lib/pwa/PwaQueueReset.tsx:12-17` calls `clearQueue()` whenever the queue DB exists. `lib/pwa/offlineQueue.ts:169-171` deletes every item. The component comment says it runs "after a session-expired redirect" too. `lib/sessionLifetime.ts:13` sets a 24 h session when remember-me is off, which is the default (`login/page.tsx:175-178`).
- *Scenario:* a receiver photographs 2 invoice pages in the walk-in with no signal, and they are queued. The session expires overnight. Next morning the middleware redirects to `/login` and the photos are gone, silently. Each lost invoice is lost leak lines (North Star).
- *Fix:*
  - Remove `PwaQueueReset` from `/login`. Shared-device privacy is already covered by `PwaSessionGuard` (`purgeOtherUsers` at sign-in, L16) and by the explicit sign-out wipe (L17-20).
  - On `/login`, read the queue (count only) and show a **T4 neutral** notice: "3 צילומי חשבונית ממתינים במכשיר · היכנסו כדי לשלוח אותם".
  - On an explicit sign-out with queued items, show a sheet instead of wiping: "יש 3 צילומים שלא נשלחו — [שלחו עכשיו] [מחקו והתנתקו]".
- *Exemplar:* Toast Go ("don't sign out, there is unsent data"); MarginEdge Pending Uploads.
- *Effort:* S. *humanPR:* no (`tenant-security-warden` review of the shared-device policy).

**auth-02 · Supplier portal: the primary "אישור ההזמנה כפי שהיא" throws away the supplier's edits** [C12, C10, rule 7] · mobile · functional
- *Evidence:* `app/s/[token]/answer-form.tsx:68-75`: `send(true)` posts `lines: []` and `note: null`. At `:200-206` the primary button is always "confirm as is"; the edits only go out through the **secondary** "שליחת התשובה עם השינויים", which is disabled until a change exists and gives no reason.
- *Fix:*
  - Make one adaptive primary. With 0 changes, keep "אישור ההזמנה כפי שהיא". With changes or a note, the primary becomes **"שליחת התשובה · 2 שינויים"** (warn-tinted summary above it: "חוסר: עגבניות 6/10 · מחיר: שמן ₪14.20").
  - Demote "as-is" to a text button that confirms: "לבטל 2 שינויים ולאשר כפי שהוזמן?".
  - Make the bar sticky at the bottom with `safe-area` padding.
- *Exemplar:* Choco and Rekki supplier order acknowledgment (one "confirm" that carries the diff); GOV.UK "check your answers".
- *Effort:* S. *humanPR:* no.

### P1

**auth-03 · Supplier portal: "already answered" (409) is shown as a successful send** [C9, H-trust] · mobile · trust
- *Evidence:* `answer-form.tsx:84` maps `res.status === 409` to `{kind:'done', status:'changes'}`, which renders "תודה! התשובה נשלחה · המסעדה תראה את החוסרים והמחירים שסימנתם" (`supplierConfirm/he.ts:69-71`). The API returns 409 for `ALREADY_ANSWERED` (`app/api/supplier-confirm/[token]/route.ts:59-60`).
- *Fix:*
  - Add a distinct state: "כבר התקבלה תשובה להזמנה הזו ב-{date} — השינויים שסימנתם עכשיו **לא נשמרו**."
  - Show the recorded answer (refetch the view) and a contact action (see auth-16).
- *Effort:* S. *humanPR:* no.

**auth-04 · Staff invite costs two emails, and its primary path is a dead end** [D1, F10, G1] · mobile · flow
- *Evidence:*
  - `dashboard/team/actions.ts:50-55`: the invite links to `/login?callbackUrl=…&email=…`.
  - `login/page.tsx:146-182`: the primary is the password form; invitees have no password.
  - `auth/he.ts:19`: the hint does not say "use the link".
  - `login/page.tsx:191-206`: a second email must be requested.
  - The email itself already proves possession of the address.
  - On iOS a magic link cannot sign in to an installed (standalone) PWA, which has its own cookie jar.
- *Fix:*
  - Short term (S): in invite mode, hide the password form and make **"שלחו לי קוד כניסה"** the primary, with copy "ההזמנה ל-{restaurant} מחכה — נשלח קוד כניסה ל-{email}".
  - Target (M): see Big Move 3, a `/join/[token]` that treats the single-use invite token as the first factor.
- *Exemplar:* Slack and Notion invite → "Join" → one screen; 7shifts and Homebase SMS invites.
- *Effort:* M. *humanPR:* no (auth change → `tenant-security-warden` review).

**auth-05 · Login is password-first with two email fields** [C5, F10] · mobile · flow
- *Evidence:* `login/page.tsx:147-163` (email #1) and `:192-202` (email #2). Visible in `login__public__phone-he.png` (y≈445 and y≈1017 @2x) and `login__public__desktop-he.png`. The code comment at L94-95 says most existing users have **no password**, so the majority path is the visually secondary one.
- *Fix:*
  - **Quick (S):** keep one email field and give the secondary button `formAction={magicLinkAction}`, so both buttons share it.
  - **Target:** identifier-first. "כתובת מייל" → "המשך" → step 2 shows the password (if set) **and** "שלחו לי קוד כניסה במייל". To avoid account enumeration, always show both options at step 2.
- *Exemplar:* Google and Microsoft identifier-first; Linear and Slack "Continue with email" → code.
- *Effort:* S→M. *humanPR:* no.

**auth-06 · A wrong password clears the typed email** [C5 "keep every typed value", F10] · mobile · functional
- *Evidence:* `login/page.tsx:48-53`: `back()` re-adds `email` only when it is an invite-locked one. `:72` and `:82` redirect without it, so the email input renders empty.
- *Fix:* return the error without a redirect (`useActionState`), or pass a non-locking `prefill` param. Then focus the password field and select its content.
- *Effort:* S. *humanPR:* no.

**auth-07 · "Check your email" is a dead-end page; magic links don't reach the installed PWA** [F10, I3] · mobile · flow
- *Evidence:* `login/check-email/page.tsx:10-29`: one sentence, no address, no resend or timer, no language control. Captured in `login_check-email__public__phone-he.png`. Auth.js nodemailer link only (`auth.ts:194-202`).
- *Fix:* send a **6-digit code plus the link** in the same email. The page reads:
  - "שלחנו קוד כניסה ל-**dana@kfar.co.il**".
  - A one-time-code field (`autocomplete="one-time-code" inputMode="numeric"`), auto-submitted at 6 digits.
  - "שליחה חוזרת בעוד 0:30".
  - On mobile, "פתיחת Gmail" and "פתיחת Outlook" buttons.
  - "לא הגיע? בדקו בספאם · כניסה עם סיסמה".
  The code completes sign-in in **the same browser or PWA** that started it.
- *Exemplar:* Slack, Notion, Linear and Vercel email codes.
- *Effort:* M. *humanPR:* no (email template + Auth.js token generation; security review).

**auth-08 · 2FA recovery codes can't be typed on a phone** [F10, lockout] · mobile · functional
- *Evidence:* `login/2fa/page.tsx:57` sets `inputMode="numeric"` on the only field. `lib/totp.ts:253-258` generates recovery codes as `xxxxx-xxxxx` from `abcdefghjkmnpqrstuvwxyz23456789`. An owner who lost the authenticator phone cannot enter a recovery code on mobile.
- *Fix:*
  - Add a link "אין גישה לאפליקציה? הזינו קוד שחזור" that swaps in a text input (`autocapitalize="off" spellcheck="false"`, placeholder `abcde-fgh23`).
  - Add "לסמוך על המכשיר הזה ל-30 יום" (a device cookie bound to the user).
- *Exemplar:* GitHub's 2FA screen (a separate "Use a recovery code" path); Google's "Don't ask again on this device".
- *Effort:* S. *humanPR:* no.

**auth-09 · Onboarding drops `callbackUrl`, so the leak-check claim is lost** [J2] · both · functional
- *Evidence:* `(marketing)/leak-check/claim/page.tsx:38` redirects to `/onboarding?callbackUrl=…`. `onboarding/page.tsx` reads no `searchParams`. `onboarding/form.tsx:21-25` always runs `router.push('/dashboard')`.
- *Fix:* read `callbackUrl` through `safeRelativePath`, pass it to the form, and push to it on success.
- *Effort:* S. *humanPR:* no.

**auth-10 · Onboarding ends on a green ₪0 control room with no path to first value** [A4, J2] · both · flow
- *Evidence:*
  - `onboarding/form.tsx:21-25` goes straight to `/dashboard`.
  - `dashboard/page.tsx:383-411` renders `ils(0)` in `text-primary`, 5xl, with "עדיין אין חשבוניות החודש" and "יעד: 1.5% מההוצאה".
  - No checklist or first-run component exists (grep `checklist|GettingStarted|firstRun` finds nothing).
- *Fix:* see Big Move 4. Until the first match, the hero shows a **labelled sample** ("דוגמה") with one CTA, "צלמו חשבונית ראשונה", plus a "1/4" checklist.
- *Exemplar:* Ramp and Stripe setup checklists; MarginEdge day-one "snap & send".
- *Effort:* M. *humanPR:* no.

**auth-11 · The invite error page is a dead end and sends invitees to create a new restaurant** [C8, D7, A7] · both · flow
- *Evidence:* `invite/accept/page.tsx:44-60`: a danger-toned title and the single link "חזרה לדשבורד". For a user with no membership, `dashboard/layout.tsx:36-39` redirects to `/onboarding`, which invites "יצירת מסעדה". `auth/he.ts:97` tells a wrong-email user to "sign in with the other address", but the page has no sign-out or switch.
- *Fix:* make the state per error code and **T4 neutral**:
  - Expired: "ההזמנה פגה · בקשו מ-{inviter} הזמנה חדשה" plus a [בקשו הזמנה חדשה] button that notifies the owner.
  - Wrong email: "מחוברים כ-x@y · ההזמנה נשלחה ל-a@b" plus [התנתקות וכניסה עם a@b].
  - Used: "כבר בצוות? [כניסה]".
- *Effort:* S (copy/actions) + M (notify owner). *humanPR:* only if routed through `notifications/outbox.ts`.

**auth-12 · Staff who sign in without the invite link can create a stray restaurant** [D1] · both · functional
- *Evidence:* `onboarding/page.tsx:18-22` checks memberships only. `onboarding/he.ts:14` is the only hint, as small print under the form (`page.tsx:45`, `text-xs text-subtle`).
- *Fix:* look up pending, unexpired invites for the verified session email. If there are any, the primary card reads "הוזמנת ל-**כפר הזיתים** כ-**מקבל/ת סחורה** · [הצטרפות]", and creating a restaurant becomes a secondary text link.
- *Effort:* M (new userScoped tRPC procedure + COVERAGE entry in the cross-tenant suite). *humanPR:* no (security review).

**auth-13 · No phone-native identity for back-door staff** [G1, FG-18, rule 9] · mobile · ia
- *Evidence:*
  - `auth.ts:153-203`: providers are Credentials + Nodemailer only.
  - `login/page.tsx:176`: remember-me is unchecked, giving a 24 h session (`sessionLifetime.ts:13`), with no cookie Max-Age (`:30`).
  - Shared devices need a full sign-out and sign-in.
  - The `authenticators` table is already wired into the DrizzleAdapter (`auth.ts:87`), so passkeys are close.
- *Fix:*
  - Quick: default "השאירו אותי מחובר/ת" **on** for a coarse pointer or the installed PWA.
  - Then add passkeys for owner and bookkeeper.
  - Then add device mode + PIN (Big Move 2).
- *Exemplar:* Toast, Square and Tabit staff passcodes; Shopify and Stripe passkeys.
- *Effort:* L. *humanPR:* **yes** (PIN/device tables → `packages/db/src/schema.ts` + migration; the PIN throttle uses the immutable `apps/web/lib/rateLimit.ts`).

**auth-14 · Supplier portal ₪ forced LTR and set in mono** [E4, B2] · mobile · rtl
- *Evidence:* `answer-form.tsx:135` uses `<bdi dir="ltr" className="font-mono tabular-nums">{formatIls(...)}</bdi>`, and `:131` sets quantities in mono. The rubric rates E4 as **S0** on counter-party surfaces. I rate it P1, because the amount is still unambiguous; escalate if the synthesis applies the rubric literally.
- *Fix:* use `<Money>` (a plain `<bdi className="tabular-nums">`, Heebo). Leave `formatIls()` itself untouched (immutable).
- *Effort:* S. *humanPR:* no.

**auth-15 · Supplier portal controls fail non-text contrast and focus visibility** [F2, F3] · mobile · a11y
- *Evidence:* `answer-form.tsx:149,167,187`: inputs use `border-line` (#D3DDD7, 1.39:1) and `focus-visible:ring-primary/60` (≈2.7:1). Labels are `text-xs text-muted` (12 px) on a page meant for phones.
- *Fix:* use the shared `Input` (`border-line-strong`, 3.59:1), the `--c-focus` ring (R-5) and 14 px labels.
- *Effort:* S. *humanPR:* no.

**auth-16 · Supplier portal lacks core acknowledgment functions** [G9, FG-08] · mobile · functional
- *Evidence:* `s/[token]/page.tsx:54-90` and `answer-form.tsx:116-207`. There is:
  - no line or order total in ₪;
  - no delivery date or time window to confirm or propose;
  - no one-tap "לא במלאי" (the supplier must type 0);
  - no substitution line;
  - no per-line note;
  - no way to call or WhatsApp the restaurant (`alreadyBody` says "צרו קשר" but gives no number);
  - no edit window after sending.
- *Fix:* see Big Move 5.
- *Exemplar:* Choco supplier app, Rekki, Pepper and Ordermentum, Coupa Supplier Portal.
- *Effort:* M–L. *humanPR:* no for the UI; yes if it writes a revised PO expectation through an engine path.

**auth-17 · Dead and expired supplier links strand the supplier** [D7, C8, J3] · mobile · flow
- *Evidence:* `s/[token]/page.tsx:36-38`: NOT_FOUND (unknown **or revoked** after a newer link was sent) → `notFound()` → `app/not-found.tsx:24-26` "חזרה לסקירה" → `/dashboard` → `/login`. Captured in `s_invalid-demo-token__public__phone-he.png`. The expired `Shell` (`:96-107`) shows no restaurant and no next step.
- *Fix:*
  - Add a portal-scoped `not-found` with no dashboard CTA: "הקישור הזה כבר לא פעיל — ייתכן שנשלח אליכם קישור חדש יותר בוואטסאפ".
  - For EXPIRED, where the token is known, show the restaurant name plus [בקשו קישור חדש], which notifies the restaurant.
- *Effort:* S (copy/route) + M (request). *humanPR:* only the notification send (`outbox.ts`).

**auth-29 · Accepting an invite lands silently on the dashboard** [D1, G7, pwa P14] · mobile · flow
- *Evidence:* `invite/accept/page.tsx:42` redirects straight to `/api/session/refresh?next=/dashboard`. There is no welcome, no role framing, no password, PIN or passkey setup, and no install coach. Without an install, iOS evicts the photo queue's storage after 7 days (pwa-field.md:100).
- *Fix:* a 3-card `/welcome?role=` first run:
  1. "ברוכים הבאים ל-כפר הזיתים · התפקיד שלך: מקבל/ת סחורה".
  2. "הוסיפו למסך הבית" (iOS share-sheet coach / Chromium prompt).
  3. "קבעו קוד כניסה מהיר".
  The cards end on the role home (today's deliveries).
- *Effort:* M. *humanPR:* no.

**auth-32 · No accessibility statement reachable from auth or the supplier portal** [F1] · both · a11y
- *Evidence:* no `/accessibility` route exists (`app/(marketing)` has about/cookies/leak-check/pricing/privacy/terms). Neither `/login` nor `/s/[token]` has a footer link.
- *Fix:* add a shared AuthShell / PortalShell footer: "הצהרת נגישות · פרטיות · תנאים". The page is owned by `growth-pmm-engineer` (cross-cutting S0 in the rubric).
- *Effort:* S (link) once the page exists. *humanPR:* no.

### P2

**auth-18 · `/login` has no brand, no way back and no signup path** [J2, J3, ia-map #17] · both
- *Evidence:* `login/page.tsx:109-214`: no logo and no link to `/` or `/showcase`. A new user trying a password gets "אימייל או סיסמה שגויים" and nothing else.
- *Fix:*
  - Put a logo linking to `/` above the h1.
  - Footer: "חדשים ב-RestoMatch? הכניסה הראשונה עם קוד במייל פותחת חשבון · [לצפייה בדמו]".

**auth-19 · Copy: gender drift and jargon** [E9] · both · copy
- *Evidence:*
  - `auth/he.ts:13` "זכור אותי" (m.sg) amid plural UI.
  - `:9` "קישור-קסם" is jargon.
  - `:98` "התנתק והתחבר" (m.sg).
  - `packages/api/src/notifications/templates.ts:175-183` (magic link): "ביקשת…תכניס אותך…אתה בפנים…פתח".
  - `:237-245` (invite) mixes "הזמין/ה", "הוזמנת" and "הצטרפו".
- *Fix:* plural imperative throughout: "להישאר מחוברים במכשיר הזה", "קוד כניסה במייל (בלי סיסמה)", "ביקשתם להתחבר — לחצו כדי להיכנס".
- *Note:* templates are in scope; `outbox.ts` is not touched.

**auth-20 · Server-action submits have no pending state** [I7] · mobile
- *Evidence:* `login/page.tsx:179,203`, `reset/page.tsx:77,116`, `set-password/page.tsx:98`, `2fa/page.tsx:65`: a plain `<Button type="submit">`; the `loading` prop goes unused. On slow back-door 4G a double tap sends two magic links, which can hit the per-mailbox throttle and produce "לא הצלחנו לשלוח קישור".
- *Fix:* a `SubmitButton` built on `useFormStatus` (spinner, disabled, no width change).

**auth-21 · Form semantics: hints not announced, onboarding validation punishes late, native bubble in the wrong language** [C5, C6, F10] · both
- *Evidence:*
  - `lib/components/Input.tsx:54-64`: `Field` mints `hintId`, but the input never gets `aria-describedby`, and the hint renders **below** the control.
  - `onboarding/form.tsx:73-90`: `pattern="\d{9,12}"` without `noValidate` lets the browser's native bubble pre-empt the Hebrew error.
  - Errors appear in one alert under the form with no `aria-invalid`.
  - Dashes are rejected instead of stripped.
  - There is no `autocomplete="organization"`.
- *Fix:* `Field` injects `aria-describedby` and places the hint between the label and the control. Onboarding uses `noValidate`, strips `[-\s]` from the ח״פ, shows inline per-field errors and focuses the first invalid field.

**auth-22 · The language control differs on every auth page** [E10, J3] · mobile
- *Evidence:*
  - A six-language picker on `/login` (`login/page.tsx:113-121`).
  - A he/en toggle on `/reset` and `/onboarding`.
  - None on check-email, 2FA, set-password and invite. Compare `reset__public__phone-he.png` ("EN") with `login__public__phone-he.png` ("עברית ▾").
  - The invite language is device/he/en only (`team/he.ts:42-46`).
- *Fix:* one `AuthShell` that carries `LanguagePicker`, and invite languages = `APP_LOCALES`.

**auth-23 · The reset flow is thin** [F10, C6] · both
- *Evidence:*
  - `reset/page.tsx:95-102`: the sent state keeps the form, with no address and no resend timer.
  - `:54-76`: the new-password step lacks the min-length hint (set-password has it at `:82`) and a show/hide toggle.
  - `actions.ts:82`: after a reset the user must sign in manually.
- *Fix:*
  - A dedicated sent state with the address and a 60 s resend.
  - The hint under the label, and an eye toggle.
  - Mint a session on a successful token consumption, then "הסיסמה עודכנה" → home.

**auth-24 · Password-field craft** [C5, F4] · mobile
- *Evidence:* no show/hide on any password field. The placeholder "••••••••" reads as an already-filled password (`login__public__phone-he.png` y≈652). "שכחתם סיסמה?" is a 12 px link at the card bottom, far from the field (`login/page.tsx:208-212`).
- *Fix:*
  - A 44 px eye toggle (`aria-pressed`, "הצגת סיסמה").
  - No bullet placeholder.
  - "שכחתם?" at 14 px, aligned at the end of the password label row.

**auth-25 · Lockout looks like a typo** [C9] · mobile
- *Evidence:* `auth.ts:173-177` returns the same null for throttled and wrong. The `login.errors.rate` key is unused by the password path.
- *Fix:* keep the uniform text, but after 2 failures add [קבלו קוד כניסה למייל] with the email prefilled, plus "אחרי כמה ניסיונות שגויים הכניסה ננעלת לזמן קצר".

**auth-26 · Signed-in users opening `/login` see the form again** [D7] · both
- *Evidence:* `login/page.tsx:55-63` never calls `auth()`, and the middleware does not redirect authed users off `/login`. An existing member opening an invite to a 2nd restaurant must sign in again.
- *Fix:*
  - Session + callbackUrl → redirect to the callback.
  - Session without one → "מחוברים כ-x · [המשך] [החלפת משתמש]".

**auth-27 · Onboarding collects too little to personalise** · both
- *Evidence:* `onboarding/form.tsx:45-82` has no signer name. `team.ts:206` then sends `inviterName: null`, and the invite reads an anonymous "הוזמנת" (`templates.ts:237-239`). Sign-out is a `text-xs` link (`page.tsx:36`).
- *Fix:* ask for "השם שלך" (`autocomplete=name`) and the restaurant (`organization`). The rest moves into the checklist (Big Move 4).

**auth-28 · Supplier portal craft** [E6, C12, G10] · mobile
- *Evidence:*
  - `s/[token]/page.tsx:47`: a Hebrew eyebrow with `uppercase tracking-wide`.
  - `answer-form.tsx:200-207`: actions are not sticky, there is no running summary, and the disabled "send changes" shows no reason.
  - The done state (`:93-104`) does not restate what was sent (order number, lines, delivery).
- *Fix:*
  - `tracking-normal`.
  - A sticky bar: "2 שינויים · [שליחה]".
  - The done card lists the diff plus "אפשר לעדכן עד {cutoff}".

**auth-31 · The cookie bar on auth and portal phones** [F3 never-hidden] · mobile
- *Evidence:* a 2-button bar of ≈95 px on every phone capture. `data-keep-clear` sits on the **magic-link** button (`login/page.tsx:203`), not on the primary "כניסה" (`:179`). With the keyboard open, a fixed bar sits over the form.
- *Fix:* on `/login*`, `/reset`, `/onboarding` and `/s/*`, render a one-line inline notice at the card foot, since only strictly-necessary cookies are set there. Or hide the bar while an input has focus (`visualViewport`).

### P3

**auth-30 · Polish** [J4, F5, C13]
- Every auth page's `<title>` is "RestoMatch" (`crawl-results.json`); use "כניסה · RestoMatch" and so on.
- There is no skip link on the auth shells or the portal.
- `not-found.tsx:24-26` nests `<Link><Button>`; use `LinkButton`.
- On phones the card-in-card costs 48 px of width; go full-bleed below `sm`.
- LTR email inputs are left-aligned under right-aligned labels; align input text to start in RTL.

---

## 4. Big moves (benchmark-grade)

### BM-1 · "Sign in like a modern app": identifier-first, passwordless by default, passkeys for the bosses
- **What:**
  - One email field → "המשך".
  - Step 2 offers "שלחו לי קוד" (a 6-digit email code + link, completed in the same browser or PWA) and "סיסמה". For owner and bookkeeper it also offers **passkey** ("כניסה עם Face ID") via WebAuthn; the `authenticators` table is already in the adapter.
  - "Trust this device 30 days" replaces daily 2FA prompts.
  - Remember-me defaults on for the installed PWA.
  - Fixes auth-05, 06, 07, 08, 24, 25.
- **Exemplar:** Linear, Slack and Notion email codes; Google and Shopify passkeys; Microsoft identifier-first.
- **Device:** both · **Effort:** M · **humanPR:** no (security review).

### BM-2 · Back-door device mode: shared phone or tablet + personal PIN
- **What:**
  - The owner binds a device to a branch once.
  - Staff switch with a **4–6 digit PIN** ("מי מקבל עכשיו?" avatar grid → PIN pad, 56 px keys).
  - Auto-lock after 5 min idle.
  - Each user's offline queue survives switches and stays attributed.
  - The device launches straight into today's deliveries.
  - Owner and bookkeeper keep 2FA or passkeys.
- **Exemplar:** Toast, Square and Tabit staff passcodes; Toast Go offline practice; 7shifts kiosk.
- **Device:** mobile · **Effort:** L · **humanPR:** **yes** (schema for devices/PINs; the PIN throttle uses the immutable `rateLimit.ts`; `tenant-security-warden`).

### BM-3 · One-tap staff join (WhatsApp / SMS / email)
- **What:**
  - The owner's invite produces a link plus a **share sheet** (WhatsApp first; `wa.me` client-side needs no outbox).
  - `/join/[token]` shows the restaurant, role, inviter's name and photo.
  - The invitee enters their name and sets a PIN, password or passkey on **one screen**, and the single-use 7-day token signs them in.
  - Then an install coach, then the role home ("המשלוח הבא: תנובה 07:30 · [התחילו קבלה]").
  - The owner's team page flips live from "ממתין" to "הצטרף ✓".
  - Fixes auth-04, 11, 12, 29.
- **Exemplar:** Slack and Notion workspace invites; 7shifts and Homebase SMS onboarding; WhatsApp group invite links.
- **Device:** mobile · **Effort:** M · **humanPR:** no (yes only if server-sent SMS/WhatsApp goes through `outbox.ts`).

### BM-4 · "4 steps to your first ₪": activation checklist + labelled sample
- **What:** replace the 2-field form with a progress-tracked checklist ("2/4") that persists on the home until done:
  1. Restaurant, your name and branches.
  2. Suppliers: pick from an Israeli supplier directory (תנובה, שטראוס, יכין…) or skip.
  3. Photograph, forward by WhatsApp, or email **one invoice** (with a "send to invoices@…" address shown).
  4. One contract price, or "use this invoice's prices as the baseline" → **run match → see the ₪**.
- Until step 4, the hero shows a **"דוגמה"** sample with one CTA. Honour `callbackUrl` (the leak-check result is step 0).
- Instrument time-to-first-₪ (target ≤10 min, rubric J2).
- Fixes auth-09, 10, 27.
- **Exemplar:** Ramp, Stripe and Brex setup checklists; MarginEdge day-one "snap & send"; Ramp's 3-way match without an ERP.
- **Device:** both · **Effort:** M–L · **humanPR:** no.

### BM-5 · Supplier portal 2.0: an order acknowledgment that feeds receiving, then claims
- **What:**
  - Header: order #, delivery window (confirm or propose a new slot), order **total ₪**.
  - Each line is a row with a 3-state segmented control **✓ כמו בהזמנה · חוסר · תחליף**: "חוסר" reveals a stepper, "תחליף" reveals product + price.
  - One adaptive sticky primary ("שליחת אישור · 2 שינויים").
  - A 10-minute edit window ("ערוך תשובה").
  - Call and WhatsApp buttons for the restaurant, he/ar/ru, and an accessibility link.
  - An accepted change becomes the **revised receiving expectation** (FG-08), so a known shortage stays T4 calm at the dock.
  - Phase 2 reuses the same token portal for **credit claims** (accept or dispute per line, upload the credit note; FG-31).
  - Fixes auth-02, 03, 14, 15, 16, 17, 28.
- **Exemplar:** Choco supplier app; Rekki; Pepper and Ordermentum; Coupa Supplier Portal; Sysco substitutions with case counts.
- **Device:** mobile · **Effort:** L · **humanPR:** yes for the claim-chase sends (`outbox.ts`, `cron.ts`); no for the portal UI.

---

## 5. Rubric scorecard (applicable criteria)

| Criterion | /login | check-email | 2fa | reset | set-password | invite | onboarding | /s/[token] |
|---|---|---|---|---|---|---|---|---|
| B1 type floor | Pass (12 px links) | Pass | Pass | Pass | Pass | Pass | Partial (xs sign-out) | Partial (12 px labels) |
| B2 money face | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **Fail** (mono ₪/qty) |
| B9 reflow | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| C5 forms | **Fail** (2 emails, email lost) | n/a | Partial | Partial | Pass | n/a | Partial | Partial |
| C6 validation | Partial | n/a | Partial | Partial (hint late) | Pass | n/a | **Fail** (native bubble, late) | Partial |
| C7 amount input | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Pass (decimal, comma) |
| C8 states | Partial | **Fail** | Partial | Partial | Pass | **Fail** (dead end) | Partial | **Fail** (404 / 409) |
| C12 buttons | Partial | Pass | Pass | Pass | Pass | Fail | Pass | **Fail** (primary trap) |
| D7 reachability | Partial (no session check) | n/a | n/a | n/a | Pass | **Fail** | Partial | **Fail** |
| E4 ₪ RTL | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **Fail** |
| E6 tracking | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Fail |
| E9 copy | Partial (gender, jargon) | Pass | Pass | Pass | Pass | Partial | Pass | Pass |
| E10 languages | Pass | Fail | Fail | Partial | Fail | Fail | Partial | Partial |
| F1 statement | Fail | Fail | Fail | Fail | Fail | Fail | Fail | **Fail** |
| F2/F3 contrast, focus | Partial (ring /60) | Pass | Partial | Partial | Partial | Pass | Partial | **Fail** |
| F5 structure | Partial (title, skip) | Partial | Partial | Partial | Partial | Partial | Partial | Partial |
| F10 auth | **Fail** | **Fail** | **Fail** (recovery) | Partial | Partial | Partial | Partial | n/a |
| G7 offline | **Fail** (queue wipe) | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| I7 pending | Fail | n/a | Fail | Fail | Fail | n/a | Pass | Pass |
| J2 first ₪ | Fail | n/a | n/a | n/a | n/a | Fail | **Fail** | n/a |
| J3 one product | Partial (no logo) | Partial | Partial | Partial | Partial | Partial | Partial | Partial |
| J4 polish | Partial | Pass | Pass | Pass | Pass | Partial | Pass | Partial |

## 6. Governance notes (AGENTS.md)
- **Human-PR required:**
  - BM-2 / auth-13: PIN and device tables → `packages/db/src/schema.ts` + new migration. The PIN throttle lives in the immutable `apps/web/lib/rateLimit.ts`.
  - Any server-sent invite, "request new link" or claim chase through `packages/api/src/notifications/outbox.ts` / `apps/worker/src/cron.ts`.
- **No immutable touch:**
  - The login and onboarding pages, `Field` / `Input`, the supplier portal UI, email *templates* (`notifications/templates.ts`) and the `PwaQueueReset` removal.
  - `<Money>` wraps `formatIls()` without changing its output.
- **Security review (`tenant-security-warden`):** auth-01, auth-04/BM-3 (invite token as first factor), auth-07/BM-1 (email code), auth-12 (pending-invite lookup; add a COVERAGE entry to `cross-tenant.attack.test.ts`; never delete one).
- **Owners:**
  - `web-feature-engineer`: auth pages, onboarding, portal UI, tRPC.
  - `rtl-design-steward`: E4/E6/F2/F3 visual fixes.
  - `growth-pmm-engineer`: login→site seam, accessibility page, leak-check claim.
  - `ocr-procurement-engineer`: offline queue (auth-01).
