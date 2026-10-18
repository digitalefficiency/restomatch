# S13 — WhatsApp + e-mail invoice ingestion, receiver PWA (wave 1)

Branch `claude/wave1-ingest` → draft PR #43 into `claude/client-ready`. Flags: `ingestWhatsapp`, `ingestEmail`,
`receiverPwa` (off by default; on for the seeded demo tenant via `features.all`; `FEATURES_OFF` kill-switch).
Migrations **0050_ingest** (1782050000000) and **0051_invoice_source_whatsapp** (1782060000000).

## What it does

**Suppliers send invoices to the restaurant on WhatsApp or by e-mail. They land in the same pipeline as a
photographed invoice:** storage under the restaurant prefix → invoice row (`ocr_pending`) → OCR job.

- **Per-restaurant secret address.** Each restaurant gets a 128-bit random token per channel. The owner sees it once:
  - WhatsApp: `https://<app>/api/ingest/whatsapp/wa_<32 hex>`, the webhook URL;
  - e-mail: `inv_<32 hex>@<INGEST_EMAIL_DOMAIN>`, the address suppliers send to.

  Only the SHA-256 is stored. *Replace address* rotates it; the old one stops working at once.
- **Allow-list.** Phone numbers and e-mail addresses, optionally linked to a supplier. A listed sender's document is
  registered and OCR'd straight away. Anything else is stored but **not** OCR'd (no spend). It waits in the inbox
  as *Needs review* until a manager approves it (optionally adding the sender) or rejects it.
- **Dashboard inbox** `/dashboard/inbox` (owner / manager act, bookkeeper reads):
  - messages with their documents, status and error (too large, unsupported type, fetch failed, duplicate…);
  - filters (all / needs review / errors);
  - approve / reject;
  - the receiving addresses;
  - the allow-list.

  It works in he and en. The nav entry appears only when a flag is on.
- **Duplicates.** The same bytes sent again are linked to the first invoice. They are never OCR'd twice.
- **Receiver PWA.** Receivers can install the app. It opens straight into receiving and has large touch targets in
  installed mode. With no connection, a he/en banner explains that photos are kept on the phone. A photo taken
  offline is queued in IndexedDB and uploaded automatically when the phone is back online. The upload is
  idempotent: the same `clientUploadId` gives the same scan and the same invoice.

## Security (public routes)

| Control | How | Test |
|---|---|---|
| Signature | WhatsApp: `X-Hub-Signature-256` HMAC-SHA256(app secret, **raw body**). E-mail: Standard-Webhooks/Svix `webhook-id.timestamp.body` HMAC with key rotation. Both are constant-time and checked **before** JSON is parsed. | `ingest.attack` "forged signature" ×2, `ingest.test` |
| Replay | E-mail: signed timestamp must be within ±5 min. Both channels: UNIQUE (restaurant, kind, provider message id), so a re-delivery is a no-op. WhatsApp: messages older than 7 days, or with no timestamp, are refused. | "replay …" ×2, "#5" |
| No tenant from the payload | The tenant comes only from the hashed token, via SECURITY DEFINER `app.ingest_resolve_channel` (`search_path` pinned; EXECUTE only for `restomatch_app`). Then **every** write runs under that restaurant's GUC on the RLS app role. A `restaurant_id` in the body is ignored. In production a WhatsApp channel must be bound to its `phone_number_id`, because Meta's app secret is platform-wide. | "cross-tenant token", "#4", "unknown/wrong-kind/revoked token" |
| Rate limit | `apps/web/lib/rateLimit.ts` store (Redis / memory): 120/min per IP (checked before the body is read) and 60/min per channel. | "rate limit per IP → 429" |
| Size + type | Body: 256 KB (WhatsApp) / 20 MB (e-mail), enforced on Content-Length **and** while streaming. Each attachment ≤ 10 MB, ≤ 10 per message. Base64 is capped before decoding. The type is **sniffed from the bytes**: PDF, JPEG, PNG and WEBP only; the declared type is ignored. | "oversized payload → 413", "oversized media and disguised file types" |
| Fail closed | Production without the signing secret (or without `INGEST_EMAIL_DOMAIN`) returns 503. Production without live provider credentials never stores fake bytes (`fetch_failed`). The live providers refuse non-Meta CDN media URLs (no SSRF). | "fails closed … 503", "#3", `ingest.test` providers |
| Allow-list spoofing | The sender is the **last** `<address>`, so a fake address in the display name does not count. | "#1" |
| Disabled feature | Webhook returns 404 (same as an unknown token). Procedures return FORBIDDEN `FEATURE_DISABLED`. Page returns 404 and the nav is hidden. | "a disabled feature is invisible", cross-tenant "flag off", e2e prod |
| Public paths | Only `/api/ingest/**` was added to `PUBLIC_PREFIX_PATHS`. `/dashboard/inbox` stays private and role-gated. | `publicPaths.test` S13 case |

**E-mail sender authentication.** An allow-listed `From` is trusted only together with a passing SPF/DKIM/DMARC
verdict from our own inbound provider (S4 I2). Until the owner enables it, e-mailed documents always wait for approval. Mitigation once live: require the provider's SPF/DKIM verdict before auto-registering. Resend exposes
it in the received e-mail, so this is a small follow-up.

## Receiver PWA — exactly what is cached

- **Service worker** `/receiver-sw.js` (route handler at the origin root), registered with scope `/dashboard/receiving`.
- **Cache Storage** (`rm-receiver-v1`) holds **only** these files: `/pwa/offline.html`, `/pwa/manifest.webmanifest`,
  `/pwa/icon-192.png`, `/pwa/icon-512.png`, `/pwa/icon-maskable-512.png`. The e2e asserts the cache contents.
- **Never cached:**
  - any page HTML (authenticated);
  - any `/api/*` or tRPC response;
  - `/scans/*`;
  - any non-GET request.

  Navigations go to the network. The static offline page is returned only when the network fails.
- **IndexedDB** `restomatch-receiver/photos` holds queued photos:
  - the blob, `clientUploadId`, `restaurantId`, poId / supplierId, and the attempt count;
  - photos are uploaded only while their restaurant is the active one;
  - an item is deleted as soon as its invoice is registered.
- **New files** are only under `apps/web/public/pwa/`, as S6 asked. The icons are rendered from the existing
  `app/icon.svg`, plus a maskable variant.

## Owner activation (not in code — nothing was activated, no accounts, no spend)

**WhatsApp Business Cloud API**
1. In Meta for Developers, create a **Business** app and add the WhatsApp product. Register the restaurant's phone
   number, or use one number per restaurant. Note the **Phone number ID**.
2. Create a System User with a **permanent access token** (`whatsapp_business_messaging`).
3. Set these in Vercel Production:
   - `WHATSAPP_APP_SECRET` (App → Settings → Basic → App secret);
   - `WHATSAPP_VERIFY_TOKEN` (any long random string);
   - `WHATSAPP_ACCESS_TOKEN`;
   - `INGEST_PROVIDER=live`;
   - optionally `WHATSAPP_GRAPH_VERSION`.

   Then redeploy.
4. In RestoMatch, go to **Invoice inbox → WhatsApp**, enter the Phone number ID, then **Create address**, and copy
   the URL (it is shown once).
5. In Meta, open WhatsApp → Configuration → Webhook. Set the callback URL to that URL and the verify token to step 3's
   value, then subscribe to **messages**. For several restaurants on one app, use a per-number **callback override**
   (`override_callback_uri`). The channel accepts only events for its bound Phone number ID.

**Inbound e-mail (Resend recommended; Postmark's JSON shape is also accepted)**
1. Pick an inbound sub-domain, e.g. `in.restomatch.co.il`. In DNS, add the **MX** records Resend shows for inbound
   on that sub-domain. This does not touch the main domain's mail.
2. In Resend, enable inbound for the domain and add a webhook to `https://<app>/api/ingest/email` for
   `email.received`. Copy the signing secret (`whsec_…`).
3. Set these in Vercel Production:
   - `INGEST_EMAIL_DOMAIN=in.restomatch.co.il`;
   - `INGEST_EMAIL_WEBHOOK_SECRET=whsec_…`;
   - `INGEST_RESEND_API_KEY` (attachment download);
   - `INGEST_PROVIDER=live`.

   Then redeploy.
4. In RestoMatch, go to **Invoice inbox → E-mail → Create address** and give `inv_…@in.restomatch.co.il` to
   suppliers. Add their billing addresses to the allow-list.
5. **Sender authentication (needed for e-mail auto-OCR):** enable SPF/DKIM/DMARC checking at the inbound provider
   so it stamps `Authentication-Results` and passes the headers in the webhook. Then set `INGEST_EMAIL_AUTHSERV_ID`
   to the provider's authserv-id: the first token of that header, e.g. `mx.resend.com`; read it from one received
   test e-mail. Confirm two things on that test e-mail: the webhook payload includes the headers, and the provider
   strips or overrides any inbound `Authentication-Results` that already carries its own authserv-id. Only an
   aligned `dmarc=pass` is trusted. Until then, allow-listed e-mail only suggests a supplier, and a manager approves each document.
6. Check the Resend attachment endpoint before go-live:
   `ResendInboundProvider` calls `GET /emails/receiving/{email_id}/attachments/{id}`. That path follows Resend's
   inbound docs at the time of writing; it is unit-tested only with mocks.

**Flags:** `restaurants.settings.features.{ingestWhatsapp,ingestEmail,receiverPwa} = true` per restaurant.
Kill-switch: `FEATURES_OFF=ingestWhatsapp,ingestEmail,receiverPwa`. Migrations 0050–0051 must be applied; 0050
puts the 4 tables under RLS on its own. Grants come from the existing blanket grant plus default privileges.

## Verification (2 layers)

All runs used local, session-owned Postgres databases (`restomatch_s13_scratch` for tests, `restomatch_s13_dev` seeded
with the demo tenant for the app) and local Redis. Nothing touched production.

### Layer 1: automated gate

```bash
export DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_s13_scratch
pnpm install --frozen-lockfile                                   # ok
pnpm --filter @restomatch/db migrate                             # through 0051, clean
# Final gate on the MERGED head (origin/claude/client-ready merged in, rls/*.sql untouched):
pnpm exec turbo run test --concurrency=1                         # 14/14 tasks — 1276 passed, 1 skipped
#   ingest 21 · db 72 (incl. migration-0050 9: RLS on all 4 tables + composite same-tenant FK attack;
#   upgrade-path + doctor: no FAIL/WARN)
#   api 566 (incl. ingest.attack 26, cross-tenant.attack with 9 ingest COVERAGE entries) · web 251
#   translate 69 · ocr 44 · matching 86 (canary unchanged) · charts 64 · catalog 50 · procurement 17 · crypto 12
#   billing 5 · worker 11 (+1 skipped)
pnpm --filter @restomatch/db check-rls                           # OK — every restaurant_id table has RLS
pnpm exec turbo run typecheck                                    # 18/18
pnpm --filter @restomatch/web exec tsc --noEmit -p .             # 0 errors
pnpm --filter @restomatch/web lint                               # 0 errors (9 warnings, none in S13 files)
pnpm db:supabase-sync --check                                    # up to date (44 files)
cd apps/web && pnpm build                                        # success — /api/ingest/*, /dashboard/inbox, /receiver-sw.js built
```

The db:doctor check inside `upgrade-path.test.ts` caught 4 unindexed foreign keys and a missing `updated_at`
trigger in my first 0050. I fixed both before release. 0050 had never left this branch, so its lock entries were
regenerated.

### Layer 2a: functional, production build plus dev server

The script is `apps/web/scripts/e2e-ingest-pwa.ts` (Playwright, Chromium 1194). The webhook simulator is
`apps/web/scripts/ingest-simulate.ts`, which sends signed stub deliveries through the real routes.

```bash
# env: .env.local + DATABASE_URL(_APP)=…/restomatch_s13_dev, WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN /
#      INGEST_EMAIL_WEBHOOK_SECRET / INGEST_EMAIL_DOMAIN = local test values; for `next start` the
#      production boot guard also needs RESEND_API_KEY / EMAIL_FROM / SUPABASE_SERVICE_ROLE_KEY → dummy
#      values (no Supabase URL ⇒ storage stays off), as other sessions did.
pnpm dev &   pnpm exec tsx scripts/ingest-simulate.ts http://localhost:3000
#  whatsapp allow-listed → 200 accepted · unknown sender → needs_review · e-mail PDF unknown → needs_review
#  disguised HTML "invoice.pdf" → rejected (unsupported_type) · forged signature → 401
PHASE=dev  pnpm exec tsx scripts/e2e-ingest-pwa.ts     # PASS (dev): 21 checks
pnpm build && NODE_ENV=production pnpm start &
PHASE=prod pnpm exec tsx scripts/e2e-ingest-pwa.ts     # PASS (prod): 143 checks (incl. queue wiped on sign-out and on the session-expired redirect)
```

Both phases were re-run on the merged head: dev 21/21, prod 140/140. **One observation:** on the first prod run
after the merge, a React #418 hydration error was logged once during the bookkeeper/he pass (`/dashboard` →
`/dashboard/inbox`). It did not reproduce in a targeted run of the same pages (bookkeeper + owner), nor in a full
re-run. The inbox formats dates with the fixed `Asia/Jerusalem` timezone (`lib/i18n/format`), so it does not depend
on the server/client timezone. I could not tie it to S13 code, and I flag it for the orchestrator's cross-QA.

- **Production phase.** It covers every role × he/en, which is 10 runs (owner, manager, bookkeeper, receiver, chef):
  - HTTP below 400 everywhere;
  - `<html lang dir>` correct;
  - **zero console errors and zero server 5xx**;
  - the inbox lists messages for owner, manager and bookkeeper, with review buttons hidden for the bookkeeper;
  - the error filter shows the translated "unsupported type";
  - the receiver and chef do not get the inbox nav, and `/dashboard/inbox` redirects them;
  - the receiving pages link the manifest.

  Webhook HTTP checks: forged signature → 401, oversized body → 413, valid signature with an unknown token → 404,
  anonymous `ingest.inbox` → 401. With **flags off**: the nav is hidden, `/dashboard/inbox` renders the 404 UI, and
  there is no manifest.
- **Mobile viewport offline test** (390×844, touch, he and en, receiver):
  - the service worker controls `/dashboard/receiving`;
  - `?source=pwa` turns on installed mode;
  - the manifest is served with its scope and 3 icons;
  - going offline shows the he/en banner;
  - a photo is stored in IndexedDB (1 queued) and the wizard says "saved on the phone";
  - an offline navigation gets the SW offline page;
  - **Cache Storage holds exactly the 5 public `/pwa/*` files**.

  In the production build there is no object storage locally, so the server refuses the upload. The photo then
  **stays queued**: it is not lost.
- **Dev phase** (local disk storage exists):
  - the allow-listed WhatsApp photo becomes a `source=whatsapp` `ocr_pending` invoice;
  - review documents are stored under `<restaurantId>/`;
  - a manager approves from the inbox, and the needs-review list goes down by one;
  - rotating the address shows the new secret once;
  - mobile: offline photo → reconnect → `scans.upload` → `startReceipt` → `registerInvoice` → queue drained,
    **exactly one** new invoice, and a later sync does not register it again.

Playwright's offline emulation does not reach service-worker fetches in Chromium. So the offline-navigation step also
aborts requests at the context level, and the test notes this.

**Screenshots** (`docs/client-ready/screenshots/`): `ingest-inbox-{he,en}.png`, `ingest-settings-{he,en}.png`,
`ingest-inbox-rotate-en.png`, `pwa-offline-{he,en}.png` (mobile), `pwa-offline-page-{he,en}.png`.

### Cross-QA (S1, DB): composite tenant FKs

S1 found that 0050 used single-column FKs, so a row could reference another restaurant's supplier, channel, message
or invoice; a probe confirmed the cross-tenant insert. 0050 was unreleased, so I amended it in place. Every tenant FK
is now composite: `(supplier_id | channel_id | message_id | invoice_id, restaurant_id)` → `(id, restaurant_id)`, as
in 0021. `SET NULL` clears only the FK column (`ON DELETE SET NULL (col)`, PG15+). `invoices` gains an additive
`UNIQUE (id, restaurant_id)`, and the FK indexes match the composite keys (db:doctor is clean). The DB-level attack
test in `migration-0050.test.ts` covers this: an A row pointing at B's supplier, channel, message or invoice →
23503; `SET NULL` keeps `restaurant_id`; a cascade stays inside the tenant. I re-ran both layers afterwards:
gate green, dev 21/21, prod 140/140.

### Cross-QA (S4, security)

S4 passed the webhooks: HMAC, replay, SSRF, size, tokens, roles, cross-tenant, the race, and the SW scope. I fixed
the three items it raised:

- **I2 (medium):** the e-mail allow-list trusted `From`. Every inbound message now carries
  `authVerdict: 'pass' | 'fail' | 'none'`. WhatsApp is always `pass`, because Meta authenticates the number.
  E-mail gets `pass` only from an RFC 8601 `Authentication-Results` header stamped with **our** inbound provider's
  authserv-id (`INGEST_EMAIL_AUTHSERV_ID`) and reporting `dmarc=pass` or `spf=pass` + `dkim=pass`. A header with any
  other authserv-id (which a sender can forge) is ignored, and the stub or an unset id gives `none`.
  - A document is auto-registered (→ OCR) only when the sender is allow-listed **and** the verdict is `pass`.
  - Otherwise the allow-list only *suggests* the supplier: the document is `needs_review`, with no invoice and no
    OCR.
  - Tests in `ingest.attack`: a spoofed `From` with no header, or with a forged header, → `needs_review`, no
    invoice; our verdict `pass` → registered. Plus unit tests for the verdict parser.
- **I3 (low, privacy):** queued photos carry `userId` + `restaurantId` and only upload for that user and restaurant.
  The queue is wiped:
  - on every sign-out form (`data-rm-logout`, desktop + mobile);
  - on any landing on `/login`, which covers sign-out and the **session-expired redirect** (`PwaQueueReset`);
  - and other users' items are purged when a different user is signed in (`PwaSessionGuard`).

  Tests: `offlineQueue.test` "S4 I3", and the prod e2e checks "sign-out clears the queue" (en) and
  "session-expired redirect to /login clears the queue" (he).
- **I4 (low):** a storage-cost amplifier. There is now a per-channel **daily byte quota** for stored,
  unregistered review documents: `REVIEW_BYTES_PER_CHANNEL_PER_DAY` = 50 MB, set in one place
  (`packages/ingest/src/limits.ts`; `INGEST_REVIEW_BYTES_PER_DAY` overrides it for ops/tests). Over the quota the
  document is kept as **metadata only** (`needs_review`, `quota_exceeded`, no blob). The inbox shows the reason and
  offers only Reject. Test: `ingest.attack` "S4 I4".
- I1 (merge order): no action, per the orchestrator.

### Refuter on the cross-QA delta (b12497f..2cbab18)

It confirmed 2 defects in the e-mail verdict parser (both fixed, with tests):

- **(High)** The verdict came from the first `dmarc=`/`spf=` text anywhere in the header, so an attacker-controlled
  property or comment (`smtp.mailfrom=dmarc=pass@evil.example`, `(… dmarc=pass …)`) forged `pass`.
- **(High)** `spf=pass` + `dkim=pass` was accepted without alignment, which can pass for the attacker's own domain.

Fix: `authVerdictFromHeaders` strips RFC 5322 comments and quoted strings, splits by `;` into resinfo, and reads
only each resinfo's **leading** `method=result`. It trusts **only `dmarc=pass`**, because DMARC is aligned with the
From domain the allow-list keys on. Two dmarc results, or two headers with our id, give `none`.

Plausible items I also fixed:
- the review quota now counts and applies to **unknown senders only**, so a flood cannot starve allow-listed
  suppliers;
- `PwaSessionGuard` is always mounted;
- a queued photo uploads only while `/api/auth/session` still reports the photo's restaurant + user, so a branch
  switch in another tab cannot misfile it.

Left as is: concurrent webhooks can overshoot the daily quota by at most N × 10 × 10 MB (READ COMMITTED read, no
lock); the per-channel rate limit bounds N. The Resend `data.headers` field and stripping of inbound
`Authentication-Results` must be confirmed at activation; this is listed in the owner steps.

### Layer 2b: independent refuter

A separate agent, which did not write this code, tried to break the branch on its own scratch DB with
proof-of-concept tests. It **confirmed 6 defects**, and all are fixed with regression tests (`ingest.attack`
"refuter regressions", `ingest.test`, `offlineQueue.test`, `cross-tenant` role/race tests):

1. A fake `<allowed@supplier>` in the From display name passed the allow-list. Fix: the last `<address>` wins.
2. An e-mail CC'd to two restaurants reached only the first. Fix: every recipient token gets the message.
3. Production fell back to the stub provider (fake bytes became an invoice), and with no domain set a token was
   accepted on any domain. Fix: an unavailable provider, and the domain is required.
4. A WhatsApp channel with no `phone_number_id` accepted any number's events. Fix: the binding is mandatory in
   production.
5. A WhatsApp message with no timestamp skipped the age check. Fix: the timestamp is required.
6. The offline queue was not tied to a restaurant. Fix: items carry `restaurantId` and only upload while that
   restaurant is active.

I also fixed four of its "plausible" items:
- approve/reject now takes a row lock, and registering requires `needs_review`;
- a store failure no longer leaves a duplicate document row;
- message status uses one shared function;
- inbox, senders and overview are now owner/manager/bookkeeper only, so receivers and chefs can no longer read
  sender phone numbers.

It also attacked these, and they held: HMAC, the size caps, token parsing, the SECURITY DEFINER function, RLS
coverage, foreign-id checks, storage-path confinement, no XSS sinks, the service-worker cache policy, and queue
idempotency.

## Immutable / shared files touched

- `packages/db/drizzle/rls/*.sql`: **not touched** (MASTER-PLAN §4). Migration 0050 itself enables RLS on its 4
  tables with rls/0002's exact policy shape (`<table>_tenant USING (restaurant_id = app.current_restaurant_id())`).
  It re-declares `app.current_restaurant_id()` with rls/0002's identical body, so a fresh migrate works before
  provision-rls runs. `check-rls` passes, and the shape test asserts RLS and the policy on all 4 tables.
- `packages/db/src/schema.ts`: additive; 4 tables, plus `whatsapp` added to the `invoiceSource` enum.
- `packages/db/drizzle/meta/_journal.json`: 2 entries.
- `supabase/released-migrations.json`: append-only, written by `pnpm db:supabase-sync`.
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: **additions only**. 9 COVERAGE entries and an
  `ingest.*` block.
- `packages/api/src/errors.ts`: added the `FEATURE_DISABLED` appCode, which MASTER-PLAN §1.3 names but which did not
  exist yet.
- `apps/web/lib/serverErrors.ts`: maps it to "forbidden".
- `apps/web/lib/publicPaths.ts` (S4): `/api/ingest`, with a test.
- `apps/web/lib/roles.ts` (S4): `/dashboard/inbox` limited to owner, manager and bookkeeper.
- `apps/web/next.config.ts` (S7): `@restomatch/ingest` added to `transpilePackages`.
- `apps/web/app/dashboard/{nav.tsx,layout.tsx}` and `lib/i18n/messages/nav/*` (S5): a **flag-aware nav** (`features?`
  on a nav item), the inbox link, and 1 label each. Other wave-1 features can reuse `features` and
  `lib/ingest/features.ts#enabledFeatures`.
- `apps/web/app/dashboard/receiving/{page.tsx,[poId]/page.tsx,[poId]/wizard.tsx}` (S2): mounts `<ReceiverPwa>` and
  routes an offline upload into the queue. This is a no-op when the flag is off.
- `apps/web/test/appRouterShape.test.ts`: adds the `ingest` router key.
- `rateLimit.ts` was **not** edited: its exported `enforceRateLimit` is used with new limits defined in
  `packages/api/src/ingest/http.ts`.
- The leak canary and all money files are untouched.

## Still open / proposals

- SPF/DKIM verdict before auto-OCR from e-mail (see residual risk).
- The inbox could show a thumbnail of each stored document. Use the existing `/scans/<id>` viewer once the invoice
  is registered.
- Clear the device queue on sign-out on shared phones. `clearQueue()` exists, but sign-out is a server action in
  S5's layout.
- The per-IP limit is shared by all tenants behind the provider's egress IPs. Raise it, or key it on the provider,
  once there is real volume.
- The WhatsApp token sits in the URL path, so it reaches access logs. Rotate it if logs leak; Meta has no
  header-secret option.
