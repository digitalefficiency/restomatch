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

**Residual risk (owner decision).** The e-mail allow-list trusts the `From` header. A forged `From` that matches an
allow-listed address gets OCR'd straight away. The cost is OCR spend plus an invoice that still goes through matching
and approvals. Mitigation once live: require the provider's SPF/DKIM verdict before auto-registering. Resend exposes
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
5. Check the Resend attachment endpoint before go-live:
   `ResendInboundProvider` calls `GET /emails/receiving/{email_id}/attachments/{id}`. That path follows Resend's
   inbound docs at the time of writing; it is unit-tested only with mocks.

**Flags:** `restaurants.settings.features.{ingestWhatsapp,ingestEmail,receiverPwa} = true` per restaurant.
Kill-switch: `FEATURES_OFF=ingestWhatsapp,ingestEmail,receiverPwa`. Migrations 0050–0051 must be applied, and the
regenerated RLS file brings the 4 tables under RLS.

## Verification (2 layers)

_(filled in below with exact commands and results)_

## Immutable / shared files touched

- `packages/db/drizzle/rls/0002_core_tenant_rls.sql`: **added** the 4 ingest tables to the per-restaurant policy
  list. Without this, `check-rls` fails CI.
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
