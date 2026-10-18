# S14 — Receiver languages (ar/ru/th/ti) + AI assistant ("Ask RestoMatch")

Branch `claude/wave1-lang-ai` → draft PR #42 into `claude/client-ready`. Both features sit behind their own flag: `receiverLanguages` and `aiAssistant`. They are off by default and on for the demo tenant (`features.all`). `FEATURES_OFF` turns them off everywhere.

## Summary

- **Receivers can use Arabic, Russian, Thai or Tigrinya.** This covers the login screen, the receiver's navigation, the receiving inbox and wizard, the invoice/PO lines and product names, the scans page and shared components. Every other screen falls back to English.
- **Owners and managers can ask questions about their money** in Hebrew or English at `/dashboard/ask`. Examples: "Why did the leak go up?", "Which supplier raised prices?", "What should I claim this week?". Each answer uses only the restaurant's own data and links to the screen the numbers come from.
- **No API key is needed to try either feature.** Item names come from a built-in glossary first. The assistant answers the 5 common questions from the data without calling Claude.

## Works (verified)

### 1. Receiver languages (`receiverLanguages`)

**i18n layer** (`apps/web/lib/i18n/*`)
- `AppLocale` = `he | en | ar | ru | th | ti`.
- The existing `Locale` (he/en) is now the **base locale**. Formatting (`formatIls`, dates, numbers) and every non-receiver screen use it, so the ~50 existing `Locale` call sites keep working unchanged.
  - `resolveLocale('ar')` returns `'en'`.
  - `getLocale()` / `useLocale()` return the base locale.
  - `getAppLocale()` / `useAppLocale()` return the locale actually rendered.
- **Partial namespaces, typed:**
  - A namespace can carry `extra: Overlays<T>`, a deep-partial of its English shape for each receiver locale.
  - Receiver-facing namespaces declare `CompleteOverlays<…>`. A missing key in any of the 4 languages is a **type error**:
    - `receiving`, `scans`, `nav`, `components` and `receiverLangs` must be complete as a whole.
    - `auth` must be complete only for its `login`, `checkEmail` and `twoFactor` subtrees, via `Pick<…>`.
  - Lookup order is overlay → en → he → key, so anything without an overlay renders in English.
  - `lib/__tests__/receiver-langs.test.ts` checks the same rules at runtime: every key exists, placeholders match, no Hebrew remains, >85% of strings are in the native script, and the fallback chain works.
- **Gating:**
  - `getAppLocale()` serves ar/ru/th/ti only when the restaurant's flag is on (`receiverLangs.status`).
  - On signed-out pages (login), it serves them unless `FEATURES_OFF` kills the feature.
  - In every other case it falls back to English.
  - `?lang=ar|ru|th|ti` is accepted by middleware.
  - `LocaleSync` adopts a member's saved receiver language only while the flag is on.
- **Picker:** `LanguagePicker`, a six-language select with native names, replaces עב/EN in the dashboard header (phone and desktop) when the flag is on, and on `/login`. In the dashboard it also saves the choice as the member's language.
- **Direction:** `<html lang dir>` follows the app locale. Arabic renders RTL; Russian, Thai and Tigrinya render LTR.

**Item and line names** (`packages/translate`, `packages/api/src/receiving/localize.ts`)
- **`TargetGlossary`** is offline and deterministic.
  - It holds 88 Hebrew-keyed rows of the most common restaurant-supply items in ar/ru/th/ti, including every name in the demo catalogue.
  - It matches the same normalized way as the English glossary.
  - It strips trailing sizes and pack counts and re-attaches them (`אקונומיקה 4 ל׳` → `Отбеливатель 4 L`).
  - It never returns a half-translated name.
- **`TargetTranslator`:** glossary first, then **`claude-haiku-5-5` with `thinking: {type:'disabled'}`**. The Claude call is one strict-JSON batch with a 20 s timeout, and the prompt says the lines are data, not instructions. It never throws.
- **`receiverLangs.localNames({locale, poId?, invoiceId?})`:**
  - Order: the **per-restaurant, per-locale DB cache** `translation_cache` (migration 0052, RLS), then the glossary, then Claude.
  - Claude is used under the existing per-restaurant hourly budget, with at most one batch per call.
  - New translations are written to the cache.
  - PO and invoice ids are re-checked against the session restaurant (foreign id → `NOT_FOUND`).
- **The receiving page and wizard** swap the display-only English line and product names for the local ones. Names without a translation keep their English, then their Hebrew. The Hebrew original stays underneath.

**Other pieces**
- **Per-member language:** migration 0052 widens the `memberships/invitations.preferred_locale` CHECK to the six locales. It only widens, so it is additive. New procedures: `receiverLangs.setMyLocale` (self) and `receiverLangs.setMemberLocale` (owner/manager, tenant-scoped).
- **Fonts:** self-hosted Noto Sans Arabic, Noto Sans Thai and Noto Sans Ethiopic (SIL OFL, variable woff2) under `apps/web/public/fonts/noto-sans-*/`. They are declared with the exact `unicode-range` from the fontsource subsets in an **append-only** block of `globals.css`. Each file downloads only when its script appears. The receiver locales put their script font first; Heebo still covers Latin and Hebrew data.
- **Native-quality strings:**
  - One translator subagent per language wrote the strings, and then a **separate reviewer subagent per language** fixed them.
  - Reviewer verdicts: ar *good*, ru *good (close to native)*, th *good*, ti *good, glossary needs native sign-off*.
  - The reviewers made 13–28 fixes per language. Real meaning errors they caught:
    - th: the sea bream was translated as pomfret.
    - ar: "not ordered" read as "not needed".
    - ti: butter was given as spiced ghee, and Amharic "again" was used instead of the Tigrinya word.
  - See **Uncertain translations** below.

### 2. AI assistant (`aiAssistant`), `/dashboard/ask`, owner/manager only

**Tools**
- There are four **read-only** tools, which reuse the same `packages/charts` computations the screens use:
  - `leak_hero`
  - `leak_report` (by type and by supplier, price increases, status)
  - `leak_breakdown` (invoices behind the leak)
  - `claimable_lines`
- They run on the RLS member transaction with the **session** restaurant id. The model can pick only a month or a limit (strict schemas; unknown fields are rejected). It writes no SQL and has no write tools.

**Claude**
- `claude-opus-5-5` with adaptive thinking (it cannot be disabled on this model) and `effort: 'medium'`.
- The loop is manual: at most 4 turns, `max_tokens` 8000, `tool_choice: auto`.
- The final answer is structured JSON (`answer` + `citations`).
- `fallbacks: "default"` (server-side refusal fallback) is enabled. The key comes from `ANTHROPIC_API_KEY`.

**Budget** (`ask/budget.ts`, migration 0053 `assistant_usage`, RLS, no question text stored)
- 60 questions and $3 of estimated Claude cost per restaurant per day.
- Each question is reserved atomically in a single upsert (`… WHERE questions < cap AND cost < cap`) before any spend.
- Failed Claude legs still count their tokens.
- A process-local burst limit of 10 per minute applies on every path.
- When a cap is hit, the question is answered offline. Nothing is refused for cost reasons.

**Offline fallback** (`ask/offline.ts`)
- It classifies the question in he/en into the 5 canned intents: leak change, leak total, price raises, what to claim, top supplier.
- It computes facts from the data and returns them with links. The web renders the sentence in he/en through `formatIls()`, so no ₪ string is built server-side.
- It is used when there is no key, the budget is spent, or Claude fails.

**Citations:** each answer lists its sources as chips linking to internal screens: overview, leak report for the month, breakdown, claim letters, invoice, supplier card. Each chip shows the cited value formatted with `formatIls`.

**Prompt-injection defence:**
- Invoice and supplier text reaches the model only inside tool_result JSON. It is clipped to 60 characters, kept on one line, and stripped of control and bidi characters.
- The system prompt says tool results are **data, not instructions**.
- The answer is then post-checked (`ask/grounding.ts`):
  - Citation links must be hrefs the tools produced.
  - A citation's label is the **screen name**, never model text.
  - A cited value must match a tool figure **of the same unit** (₪, %, or count).
  - URLs, bare domains, markdown links and phone numbers are stripped from the text.
  - Every number in the text (including "40 אלף", "5k" and Hebrew "שקלים") must match a tool figure. Otherwise the answer is shown with a "check the linked screens" warning.
- In the translator, a Claude result that drops a number of its source line is rejected. Claude results are **never memoized across tenants**.

**UI:** a he/en page with the 5 suggestion chips, a conversation view, an AI-vs-data badge, an offline note, sources, and a questions-left counter. The nav item appears only for owner/manager with the flag on; otherwise the page returns 404.

### 3. Namespaces, COVERAGE, isolation

- New namespaces: `receiverLangs` and `ask`, both registered in `messages/index.ts`.
- COVERAGE entries in `cross-tenant.attack.test.ts`:
  - `receiverLangs.status`, `receiverLangs.localNames`, `receiverLangs.setMyLocale`, `receiverLangs.setMemberLocale`
  - `ask.status`, `ask.ask`
- A new describe block covers foreign-id and isolation cases A → B: foreign PO/invoice ids are `NOT_FOUND`, B's member can't be changed, an `ask` answer never contains B's ids or invoice numbers, and the flag is read only for the session restaurant.

## Receiver-language quality pass (orchestrator ask, after S4 cross-QA)

Each language got one more reviewer pass. Every string was checked against its he/en source for meaning and for length, since it must fit buttons on a 390 px phone:

| Language | Strings changed | Flagged for a native speaker | Notes |
|---|---|---|---|
| Arabic (ar) | 11 | 14 | terms unified: invoice فاتورة, order طلبية, delivery توصيلة |
| Russian (ru) | 17 | 13 | shorter buttons; delivery notes renamed "документы поставок" so they no longer clash with "накладная" |
| Thai (th) | 18 | 17 | invoice term switched to the everyday **บิล** (34 places) |
| Tigrinya (ti) | 7 | 53 high-priority (P1) + 56 other (P2) | buttons shortened; Amharic words replaced; the gender of ፋቱራ made consistent |

- **Unit words:** word units now show in the receiver's language for ar/ru/th (for example "17 ربطة", "ящик", "ลัง"). Symbols such as kg, g, L and ml are unchanged. Tigrinya stays English until a native review. The code is `unitLabelFor` in `packages/translate/src/units.ts`.
- **Native-speaker review lists:** the full per-language lists (every change, plus every string to confirm) are in **`docs/client-ready/reports/wave1-lang-ai-native-review.md`**.

## Uncertain translations (please have a native speaker check)

- **Tigrinya (most important):** nav `ሰንሰለት`/`ጨናፍር` (chain/branches, added at merge time without review);
  - UI wording: `ደጊምኩም ፈትኑ` ("try again"); `ቅጥዕታት` vs `ምድላዋት` (Settings); language names ending in Amharic-style `-ኛ`; loanwords `ፋቱራ`, `ሊንክ`, `ኣካውንት`.
  - Glossary items: `ቡሮ` (butter), `ፉንጊ` (mushrooms), `ርጉእ` (yogurt), eggplant (`ባደንጃን` vs `ሜላንዛና`), bell pepper (`ፐፐሮኒ`?), chicken thigh `ሰለፍ`, black pepper, bleach (`ክሎሪን` vs `ቫርኪና`).
  - Cucumber, green pepper, merguez, sourdough and red wine are deliberately left empty, so they fall back to English.
- **Arabic:**
  - Levantine vs MSA grocery words (`طماطم` vs `بندورة`); `حمص يابس`; `طحينة خام`; `لبن زبادي`; `خبز عربي (بيتا)`.
  - Plural agreement is correct only for counts 3–10 (`{count} أصناف`). Other counts need ICU plurals; see the proposals.
- **Russian:**
  - `накладная` is used for every invoice the worker handles; the consolidated invoice is `сводный счёт`.
  - Fish: `Дорадо` vs `денис`. Bleach: `хлорка`?
  - Counts use the neutral form "Позиций: {count}".
- **Thai:**
  - `ใบแจ้งหนี้` and `ผู้จำหน่าย` are formal; kitchen staff may say `บิล` / `ซัพพลายเออร์`.
  - Item names: `ปลาซีบรีม (ดอราโด)`, `ปลาทูน่าแดง`, `ยี่หร่าป่น`, and the sound-alikes for challah and labneh.

## Fixed during verification (independent refuter + screenshots)

| Finding | Fix | Test |
|---|---|---|
| **H1** One tenant's Claude batch could poison the process-wide translation memo, which another tenant then stored in its own cache | Only glossary results are memoized; Claude results go to the per-restaurant DB cache only; miss and backoff keys include the restaurant; a translation that drops a source number is rejected | `targets.test.ts` "never shared across tenants", "drops a number" |
| **H2** A failed Claude leg recorded 0 tokens (budget bypass) | `AskRunError` carries the running totals and the catch path records them | `ask.test.ts` "a FAILED Claude leg still counts its tokens" |
| **H3** Budget check-then-act race | Atomic upsert reservation before any spend; the row lock serializes a restaurant's concurrent asks | `ask.test.ts` "over the COST cap" / daily cap |
| **M1** Hebrew-word, k-scaled and bare made-up figures were treated as grounded | Every number in the prose is checked (multipliers handled; years and dates skipped) | `ask.test.ts` "Hebrew-word / k-scaled…" |
| **M2** Model-written citation labels; units not checked; bare domains and phones left in the text | Label = screen key; value must match the same unit's pool; domains and phones stripped | `ask.test.ts` "SAME unit" |
| **M4** One budget unit could cover ~15 Claude batches | At most one batch (80 names) per call | — |
| **L1** A line named "constructor" crashed the wizard | Null-prototype map server-side; `Object.hasOwn` client-side; plain object across the RSC boundary (this was a real 500 caught by layer 2) | layer 2 |
| **L2** Offline "leak change" counted a supplier outside the top 8 as entirely new | Deltas computed over the full lists | — |
| **L3** "Why did the leak increase?" was routed to price raises | Intent rules reordered | `ask.test.ts` |
| **L5** No rate limit on the offline path | The burst limit applies to every path (`TOO_MANY_REQUESTS`) | `ask.test.ts` burst |
| Screenshots | Hebrew answers now show Hebrew product/supplier names; ₪0 lines are no longer listed as claimable; the question form no longer covers answers | layer 2 |
| db:doctor | `assistant_usage.updated_at` gets the standard `set_updated_at` trigger (0053) | `supabase-deploy.test.ts`, `upgrade-path.test.ts` |

## S4 security cross-QA (#42 @ a04265a) — fixes

| Finding | Fix | Test |
|---|---|---|
| **L1** The answer sanitizer stripped domains only from a fixed TLD list, so `evil.ly/…`, `secure-restomatch.dev`, `restomatch.shop/pay` and `evil[.]com` survived while the answer stayed `grounded:true` | Detection runs on **normalized** prose: NFKC; invisible chars removed; look-alike dots (`。．｡․…`) mapped to `.`; defanged `[.]`/`(.)`/`{dot}`/` dot ` (any case) and spaced dots restored. It then strips any scheme, `www.`, user@host, @handle, IPv4/IPv6/hex IP, international/Israeli/toll-free/`*` numbers, and any host whose TLD is real: an allow-list of ~200, punycode, IDN (`.ישראל`, `.рф`) or a homoglyph spoof (`.cоm`). **Any removed link sets `grounded:false`.** Prose like `spend.Next`, `report.xlsx`, `Mr. Cohen`, a double space or `<5%` is not flagged. | `ask.test.ts` "S4 cross-QA L1" (the 4 strings + an IP, plus 20 obfuscations and 11 benign phrases) |
| **L2** The 10/min burst limit was process-local (per lambda) | `setAskBurstLimiter()` (globalThis registry, safe across bundles) is registered at boot in `instrumentation.node.ts` → `lib/askRateLimit.ts` → the shared Redis `enforceRateLimit` (`rateLimit.ts` itself is untouched), keyed `ask:<restaurantId>`. The process-local window still applies on top, so a Redis outage never means "no limit". The durable daily cap is unchanged. | `ask.test.ts` "S4 cross-QA L2"; layer 2 saw the `ask:<id>:<window>` key in Redis |
| **L4** `dump.rdb` was modified in the PR | Restored from the base; locally marked `skip-worktree` | `git diff origin/claude/client-ready -- dump.rdb` is empty |
| **L3** The `when` order of 0052/0053 | Not renumbered (orchestrator handles it at integration) | — |

### S4 re-verify @ 1a7a742: L1 still bypassable → inverted rule

S4 found phishing gTLDs (`.zip .mov .bond .sbs .cfd .lat .quest`), `e v i l . c o m` and `evil,com` still returned `grounded:true`. The tight `label.word` form is now **inverted**: it is a link unless it is
- a file extension from a short list (`xlsx csv pdf png jpg…`, **not** zip/mov);
- a number, or a Hebrew word (a sentence missing its space);
- a 2-label prose shape with no port/path: a Title-case English sentence starter (`spend.Next`, `rose.It`); a Title/UPPER-case word that is **not a real TLD** (`excl.VAT`, `Q3.Revenue`); a numbered list item (`1.Tnuva`); or an abbreviation + a word that is not a real TLD (`avg.price`).

"Real TLD" is the full list of 1,288 ASCII TLDs, vendored as a constant in `ask/tlds.ts` from the Public Suffix List in `tldts@7.0.30` (no network at runtime).

Detection-only normalization: spaced-out characters (`e v i l . c o m`, `e-v-i-l.c-o-m`, `evil . c o m`, newline-separated) are collapsed on a copy, and the run is stripped only if the copy is a link. `,` / `;` between labels (`evil,com`, `evil, com`) counts as a dot only before an unmistakable TLD (ccTLDs + com/net/org/…), so `cash,credit` and `milk,eggs` stay prose.

**Refuter round 3** (one independent agent, about 190 probes) found more and they are fixed:
- Bypasses:
  - variation selectors, tag characters, braille blank and combining marks splitting a label (`evil.c̲om`), and a combining dot above used as a dot;
  - more dot look-alikes (`⸱ ⸳ ܁ ᛫ ⦁ ㆍ ᐧ`);
  - `נקודה` / `_dot_` / `-dot-` / `punkt` / `[,]` / `(at)`;
  - restaurant gTLDs behind an abbreviation (`ref.menu`, `max.pizza`);
  - Israeli phones with en dashes, dots, parentheses, odd grouping or spaced digits.
- False positives:
  - `Data: 3 invoices` (a scheme needs a non-space after the colon);
  - `Prices rose. Today: ₪1,200` (the spaced "after-dot" form now needs a lower-case TLD that ends the token);
  - invoice numbers read as phones (`01234567`, `00012345678`, `03123456`) or IPs (`INV-26.10.18.001`; octets ≤255);
  - `10@3.50`, markdown `*1250 ₪*`, `Note::`;
  - `excl.VAT`, `vs.April`, `Dr.Oetker`, `Mon.Tue`, `1.Tnuva`, `cash,credit`.

**Accepted trade-offs**, documented here:
- Lower-case run-ons (`eggs.bread`) are flagged, as are tokens whose word really is a TLD (`Coke.Zero`, `Mr.Kitchen`, `invoices.zip`, `v2.Final`).
- A Title-case ccTLD sentence starter (`evil.It`) still passes, because `rose.It came…` has to.
- These are not detected: digits spaced out without the leading 0, `evil at gmail`, `telegram evilbot`, and `Invoice no. 1700-123-456` (flagged as a toll-free number).

A flag only means the answer shows the "check the screens" note; no answer text is ever turned into a link.

Tests: `ask.test.ts` "S4 cross-QA L1":
- each S4 string (and `Evil.Com`, `evil.Zip`, `evil,co,il`);
- 27 round-3 bypasses;
- 23 round-3 benign phrases;
- the original 11 must-not-flag phrases plus 5 more.

The earlier cross-QA fixes were also reviewed by one independent refuter. Its round-2 findings are fixed: look-alike/spaced/IDN/zero-width domains no longer survive, whitespace-only flagging is gone, `spend.Next`-style false positives are gone, and IPv6/hex IPs/other phone formats are covered. It found nothing in L2.

New untranslated-by-review strings (merged in from the base): `receiving.errors.queueUnavailable` in ar/ru/th/ti, written by me with no reviewer pass. Tigrinya especially needs a native check.

## Arabic RTL on the receiver phone flow (390 px, production build)

Script: `apps/web/scripts/verify-receiver-phone.ts`. For each locale it walks inbox → PO → demo invoice → reconciliation → adjust (every line settled) → close → confirmed. At each step it checks:
- `<html lang/dir>`
- no horizontal page scroll at 390 px
- no clipped or off-screen button, link or chip
- the step text is in the locale's script
- for **ar**, `#main-content` and every Arabic item name compute `direction: rtl`
- zero console errors and zero 5xx

Result on the final build: **95/95 passed** (ar, ru, th, ti). Screenshots: `docs/client-ready/screenshots/wave1-lang-ai/phone-{ar,ru,th,ti}-{1..5}-*.png`.

**Intermittent React #418 (hydration text mismatch):**
- Where it appeared: twice across about 10 runs of `verify-wave1-lang-ai.ts`, on different pages (once on `/dashboard/ask` as the Hebrew owner, once during the receiver section).
- Where it did not reproduce: the 390 px phone flow (95/95, no console errors), 48 targeted navigations, or the 3 runs after I added URL logging to the script.
- Likely source: shared dashboard chrome rather than an S14 screen. Still unproven; flagged for S5/S7 cross-QA.

## Still open / not done

- **M3 (refuter, plausible):** the Claude calls (assistant and translator) run inside the RLS member transaction, so a pooled connection is held for the duration of the call (up to 4×45 s for the assistant). It is fine at demo scale. The fix is to do the reads in the transaction, call Claude outside it, then open a short transaction for the cache and usage writes. That needs a non-transactional entry point in `trpc.ts`, which is an S4/S7 boundary.
- **L4 (UX):** in Arabic, screens that have no overlay show English text in an RTL layout. This is acceptable for the receiver scope. The fix is to pick `dir` per namespace.
- **L6:** the assistant's month uses Asia/Jerusalem, while the chart SQL uses `restaurants.timezone`. They are the same for every current tenant.
- **Hydration warning:** one layer-2 run showed a single React #418 on the Hebrew assistant page. It did not reproduce in the two runs after it (both clean); possibly the relative-time worker banner. Watch for it in cross-QA.
- **Plurals:** there is no ICU plural support, so the Arabic and Russian count strings use neutral forms.
- The reconciliation step's line names were checked through the page payload (11 localized names per locale) and API tests, not clicked through end-to-end. The sandbox has no worker or OCR running.
- `drizzle/rls/0002_core_tenant_rls.sql` was **not** edited. Both new tables enable RLS with the standard policy in their own migration, and the invariant "has `restaurant_id` ⇒ RLS enabled" holds. When the owner next edits that file, add `translation_cache` and `assistant_usage` to its list.

## Feature & improvement proposals

1. **ICU plurals** in the i18n runtime (`{count, plural, …}`), needed for Arabic and Russian. High value / M.
2. **Native-speaker review pass** of the Tigrinya UI and glossary; an Eritrean staff member, about 1 h. High / S.
3. **Speak the item name** (Web Speech) for low-literacy receivers. High / S.
4. **Restaurant-specific glossary overrides** stored in `translation_cache` with `source='manual'` (the schema already allows it). Med / S.
5. **Streaming assistant answers** and a short conversation memory. Med / M.

## Immutable / shared files touched (owner review)

- `packages/db/src/schema.ts`: **additive** `translationCache` and `assistantUsage` tables, plus the `bigint`/`date` imports.
- `packages/db/drizzle/meta/_journal.json`: entries for 0052 and 0053 (`when` 1782070000000 and 1782080000000).
- New migrations `0052_receiver_languages.sql` and `0053_ai_assistant.sql`, plus the generated `supabase/migrations/*` and `released-migrations.json` (from `pnpm db:supabase-sync`).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: **additions only** (6 COVERAGE entries and 4 tests).
- `packages/api/src/errors.ts`: + `FEATURE_DISABLED` app code (MASTER-PLAN §1.3). `apps/web/lib/serverErrors.ts` maps it to "forbidden".
- `apps/web/lib/roles.ts`: + `'/dashboard/ask': ['owner','manager']`.
- `packages/api/src/routers/settings.ts` (`myLocale`): passes the four receiver locales through.
- Shared files owned by other areas (minimal changes):
  - **i18n foundation:** `config.ts`, `translate.ts`, `server.ts` and `client.tsx` under `lib/i18n/`, plus `app/layout.tsx`.
  - **Dashboard, nav and login:** `middleware.ts` (`?lang=` accepts receiver locales), `app/dashboard/layout.tsx`, `nav.tsx` and `locale-sync*.tsx`, and `app/login/page.tsx` (shows the picker).
  - **Receiving:** the `index.ts` files of `receiving`, `scans`, `nav`, `components` and `auth` (one line each to attach overlays); `app/showcase/receiver/_steps/english.tsx` (`lang` attribute on the local name); `app/dashboard/receiving/[poId]/{page,wizard}.tsx`.
  - **Tests and dependencies:** `test/appRouterShape.test.ts`; `packages/api/package.json` (`@anthropic-ai/sdk`, same version as ocr/translate); `pnpm-lock.yaml`.
- No change to engine.ts, rls.ts, the approvals engine, cron.ts, outbox.ts, leads.ts, plans.ts or the CI workflows. The leak-canary is unaffected.

## Owner actions

- Add `ANTHROPIC_API_KEY` in Vercel to switch the assistant and the translation leg from offline to Claude. Optional overrides: `ASK_WITH_CLAUDE=0` and `TRANSLATE_WITH_CLAUDE=0`.
- Decide when to turn on `receiverLanguages` and `aiAssistant` for real tenants.
- Have a native speaker review the uncertain items above, Tigrinya first.

## Verification (2 layers)

### Layer 1: full gate (final head, after merging `origin/claude/client-ready` @ 80a3934)

Latest run (after the S4 re-verify inverted rule + refuter round 3, and merging `origin/claude/client-ready` @ ccb328a): turbo test 13/13 tasks, **1327 tests** (api 576, web 290…), typecheck + lint 18/18 (0 errors), supabase-sync up to date (44 files), web build success; layer 2a on that production build: verify 83/83, 390 px phone flow 95/95 (ar/ru/th/ti), 0 console errors. Note: the base now refuses `next start` without its production secrets — the local layer-2 server ran with placeholder `RESEND_API_KEY`/`EMAIL_FROM`/`SUPABASE_SERVICE_ROLE_KEY` and `AUTH_URL`/`APP_URL=http://localhost:3100` (nothing sent, nothing committed).

Earlier run (after the S4 cross-QA fixes): turbo test 13/13 tasks, **1319 tests** (api 574, web 290, db 73…), typecheck 17/17, lint 0 errors, supabase-sync up to date, web build success; layer 2a 83/83 again on that build.


The latest run is on the merged head: 13/13 tasks, **1271 tests** (api 563, web 271, db 68, charts 64, …), turbo typecheck 17/17, web tsc 0 errors, lint 0 errors, supabase-sync up to date (44 files), web build success.
- **Local DB rebuild:** the merge brought in base migration 0033, which sits below the already-applied 0052/0053 (a journal gap). I rebuilt the local DBs with `pnpm --filter @restomatch/db reset`, then ran `provision-rls` and `seed-demo`.
- **One transient failure:** the first test run on the fresh test DB failed `cutover-checks` ("2 invoice_scans* policies") before `provision-rls` had run. It passed on every run after that.

The block below is the earlier pre-merge run, kept for reference:

```
pnpm install                                         → lockfile +3 lines (@anthropic-ai/sdk in packages/api)
DATABASE_URL_TEST=…restomatch_test pnpm exec turbo run test --concurrency=1 --continue
  → 13/13 tasks green, 1158 tests:
    api 529 · web 227 · matching 86 · translate 80 · db 64 · catalog 50 · ocr 44 · charts 33
    procurement 17 · crypto 12 · worker 11 (+1 skipped) · billing 5
    new: api ask.test.ts (20), receiver-langs.test.ts (8), cross-tenant S14 block (4);
         translate targets.test.ts (11); web receiver-langs.test.ts (28); db migration-0052/0053 (5)
pnpm exec turbo run typecheck                        → 17/17
apps/web: pnpm exec tsc --noEmit -p .                → 0 errors
apps/web: pnpm lint                                  → 0 errors (6 pre-existing warnings in other files)
pnpm db:supabase-sync --check                        → up to date (42 files)
apps/web: pnpm build                                 → success (/dashboard/ask 6.82 kB)
```

### Layer 2a: production build, clicked through with Playwright

`next build && next start -p 3100`, with `NODE_ENV=production`, the RLS app role from `.env.local` (`DATABASE_URL_APP`), and password login as the seeded users. Dummy `RESEND_API_KEY`/`EMAIL_FROM`/`SUPABASE_SERVICE_ROLE_KEY` were set only to satisfy the boot guard; no email is sent with password login.

```
BASE_URL=http://localhost:3100 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  pnpm exec tsx apps/web/scripts/verify-wave1-lang-ai.ts   → 83 passed, 0 failed (re-run on the merged head: 83/0)
```

The post-merge build caught a merge-resolution error in `globals.css` (an unclosed block). It is fixed: the file now equals the base plus the append-only S14 block (+69/−0).

- **Login page (ar/ru/th/ti), signed out:** HTTP 200; `<html lang dir>` = ar/rtl, ru/ltr, th/ltr, ti/ltr; title in the native script; zero console errors.
- **Receiver session (phone viewport), all 4 locales:**
  - The receiving inbox and a PO page return HTTP 200, with the heading in the native script and the language picker visible.
  - **The PO lines carry localized names** in the payload: 11 in ar/ru/th, 10 in ti.
  - A non-receiver screen (settings) renders with the English fallback.
  - The receiver **cannot** open `/dashboard/ask` (redirected).
  - Zero console errors and zero 5xx.
- **Assistant (offline mode, no key in the sandbox), owner in he and en, manager in en:**
  - The nav item is shown; HTTP 200; correct lang/dir.
  - The three suggestion chips each return an answer in the right language with ₪ figures.
  - The source chips link to internal screens, and the first source screen returns HTTP 200.
  - Zero console errors.
- **Real failures this layer caught and I fixed:**
  - A 500 on the PO page (a null-prototype object passed to a client component).
  - English product names in Hebrew answers.
  - ₪0 claim lines.
  - The question form covering answers.
- **Rate limits seen during repeated runs:**
  - Running the script twice within one minute trips the assistant's 10-per-minute burst limit (expected behaviour).
  - Repeated receiver logins trip the per-email login limiter (expected behaviour). The script now logs in once and switches locale by cookie.
- **Screenshots:** `docs/client-ready/screenshots/wave1-lang-ai/` holds `{ar,ru,th,ti}-{login,receiving-inbox,receiving-po}.png`, `ask-he.png` and `ask-en.png`.

### Layer 2b: independent refuter

A separate subagent reviewed the whole diff, ran targeted tests and probes, and edited no files.
- Its result: no direct cross-tenant read or write path, and no server-side flag bypass.
- It reported 3 high, 4 medium and 7 low findings. H1–H3, M1, M2, M4, L1–L3 and L5 are fixed with tests (table above). M3, L4, L6 and L7 are documented under *Still open*.
- After the fixes, layer 1 and layer 2a were re-run on the final head with the results above.
