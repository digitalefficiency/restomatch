# Audit-gate exceptions (`pnpm audit`)

The CI supply-chain gate runs `pnpm audit --prod --audit-level=high` and **fails
the build on any high/critical advisory** in the production dependency tree
(`.github/workflows/ci.yml` → `audit` job).

To keep the gate meaningful (fail on _new_ high/critical) while not blocking on a
backlog of pre-existing transitive advisories, the advisories below are
explicitly baselined in `package.json` → `pnpm.auditConfig.ignoreGhsas`. This is
an **itemized, dated allow-list — not a blanket suppression**. Any advisory not
listed here will still fail CI.

- **Baselined on:** 2026-06-27
- **Review by:** 2026-09-27 (90 days) — re-run `pnpm audit --prod` and prune any
  entry whose dependency has since been patched/bumped; investigate anything new.

> Removing an entry that is already patched is a no-op (ignoring an absent GHSA
> does nothing), so this list is safe to prune aggressively at review time.

## Deployed surface (apps/web, apps/worker, packages/\*) — priority remediations

| GHSA | Package | Sev | Notes / remediation path |
|------|---------|-----|--------------------------|
| GHSA-267c-6grr-h53f | next | high | Next.js 15.3.9. Track Next patch release; several of these are SSRF/cache/redirect classes mitigated by our middleware + RLS. |
| GHSA-26hh-7cqf-hhc6 | next | high | as above |
| GHSA-36qx-fr4f-26g5 | next | high | as above |
| GHSA-8h8q-6873-q5fj | next | high | as above |
| GHSA-c4j6-fc7j-m34r | next | high | as above |
| GHSA-mg66-mrh9-m8jx | next | high | as above |
| GHSA-q4gf-8mx6-v5v3 | next | high | as above |
| GHSA-p6gq-j5cr-w38f | nodemailer | high | Bump nodemailer (apps/web). Pre-existing peer pin (@auth/core wants nodemailer 7). Resolve alongside Epic B auth work. |
| GHSA-rcmh-qjqh-p98v | nodemailer | high | as above |
| GHSA-gpj5-g38j-94v9 | drizzle-orm | high | packages/api. Track drizzle-orm patched release; bump when the ORM major lands a fix compatible with our schema. |

## apps/mobile (Expo / React Native dev tooling — NOT in the deployed prod surface)

Production is web + worker; the Expo app's CLI/build tooling dominates this list.
Lower priority, tracked for hygiene.

| GHSA | Package | Sev |
|------|---------|-----|
| GHSA-w7jw-789q-3m8p | shell-quote | critical |
| GHSA-2v35-w6hq-6mfw | @xmldom/xmldom | high |
| GHSA-f6ww-3ggp-fr8h | @xmldom/xmldom | high |
| GHSA-j759-j44w-7fr8 | @xmldom/xmldom | high |
| GHSA-wh4c-j3r5-mjhp | @xmldom/xmldom | high |
| GHSA-x6wf-f3px-wcqx | @xmldom/xmldom | high |
| GHSA-34x7-hfp2-rc4v | tar | high |
| GHSA-83g3-92jg-28cx | tar | high |
| GHSA-8qq5-rm4j-mr97 | tar | high |
| GHSA-9ppj-qmqm-q256 | tar | high |
| GHSA-qffp-2rhf-9h96 | tar | high |
| GHSA-r6q2-hw4h-h46w | tar | high |
| GHSA-96hv-2xvq-fx4p | ws | high |
| GHSA-hmw2-7cc7-3qxx | form-data | high |
| GHSA-vxpw-j846-p89q | undici | high |

## How to refresh this baseline

```sh
pnpm audit --prod --json | node -e 'let r="";process.stdin.on("data",d=>r+=d);process.stdin.on("end",()=>{const a=JSON.parse(r).advisories||{};for(const v of Object.values(a))if(["high","critical"].includes(v.severity))console.log(v.severity,v.github_advisory_id,v.module_name);})'
```

Compare the output against `pnpm.auditConfig.ignoreGhsas`; add genuinely-accepted
new entries here with a reason, remove patched ones.


## 2026-09-08 — `apps/mobile` transitive advisories (dormant app, baselined)

`apps/mobile` (Expo) is not built, not deployed and has no working auth transport
(plan v2, gap P-mobile; decision pending: revive or remove from the workspace).
`pnpm audit --prod` still walks its dependency tree, so the weekly drift sweep now
reports 26 high/critical advisories whose ONLY paths are
`apps__mobile>expo-router>…` / `apps__mobile>expo>…`. They cannot reach a running
RestoMatch process. Baselined here rather than fixed so the gate keeps failing on
advisories that DO reach web/worker.

**Review trigger:** the moment `apps/mobile` is revived, drop these ignores and
upgrade Expo; if the app is removed from `pnpm-workspace.yaml`, delete them.

| GHSA | Package | Severity | Patched |
|---|---|---|---|
| GHSA-23hp-3jrh-7fpw | `tar` | critical | >=7.5.19 |
| GHSA-28wg-ghj8-5hjv | `nanoid` | high | >=3.3.16 |
| GHSA-2v37-7h3g-55p8 | `nanoid` | high | >=3.3.18 |
| GHSA-395f-4hp3-45gv | `shell-quote` | high | >=1.9.0 |
| GHSA-3jxr-9vmj-r5cp | `brace-expansion` | high | >=1.1.16 |
| GHSA-3jxr-9vmj-r5cp | `brace-expansion` | high | >=2.1.2 |
| GHSA-4c8g-83qw-93j6 | `fast-uri` | high | >=3.1.3 |
| GHSA-52cp-r559-cp3m | `js-yaml` | high | >=3.15.0 |
| GHSA-52cp-r559-cp3m | `js-yaml` | high | >=4.3.0 |
| GHSA-5p2g-fcmc-qvqq | `image-size` | high | <0.0.0 |
| GHSA-5p4m-2wfm-xmqj | `js-yaml` | high | >=3.15.1 |
| GHSA-5p4m-2wfm-xmqj | `js-yaml` | high | >=4.3.1 |
| GHSA-73wf-gq98-2v4g | `browserslist` | high | >=4.28.7 |
| GHSA-7p8r-x3mc-p8w7 | `fast-uri` | high | >=3.1.5 |
| GHSA-8x88-c5mf-7j5w | `tar` | high | >=7.5.18 |
| GHSA-c83g-rgw3-j3cx | `browserslist` | high | >=4.28.7 |
| GHSA-f65p-4m7j-42xc | `fast-uri` | high | >=3.1.6 |
| GHSA-fph4-wmhf-6fwf | `fast-uri` | high | >=3.1.6 |
| GHSA-jqff-g426-hqxp | `fast-uri` | high | >=3.1.6 |
| GHSA-mh99-v99m-4gvg | `brace-expansion` | high | >=1.1.17 |
| GHSA-mh99-v99m-4gvg | `brace-expansion` | high | >=2.1.3 |
| GHSA-r292-9mhp-454m | `tar` | high | >=7.5.21 |
| GHSA-rgw5-rvv9-x895 | `brace-expansion` | high | >=1.1.18 |
| GHSA-rgw5-rvv9-x895 | `brace-expansion` | high | >=2.1.4 |
| GHSA-v2hh-gcrm-f6hx | `fast-uri` | high | >=3.1.4 |
| GHSA-w3rx-r6r6-pgpr | `image-size` | high | <0.0.0 |

**Not baselined (must be fixed, tracked in plan v2 Wave 0 / Session 2 "dependency
security bumps"):** `next` 15.3.9 → ≥15.5.21 (GHSA-m99w-x7hq-7vfj,
GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4), `next-auth` 5.0.0-beta.25 → ≥beta.32 and
`@auth/core` → ≥0.41.3 (GHSA-7rqj-j65f-68wh critical, GHSA-8fpg-xm3f-6cx3 critical,
GHSA-xmf8-cvqr-rfgj), `sharp` → ≥0.35.0 (GHSA-f88m-g3jw-g9cj), `postcss` → ≥8.5.18
(GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849). The audit job stays red until that PR lands.

## 2026-10-18 refresh (client-ready sprint)

New high advisories published after the 2026-09-08 freeze turned the gate red. Fixed rather than
ignored wherever a patched release exists:

| Package | Fix | Path |
|---|---|---|
| nodemailer | `apps/web` → `^10.1.2` (GHSA-v53p-9fqp-m79j, GHSA-r7g4-qg5f-qqm2, GHSA-2x7j-588g-ccc2). `@auth/core`'s optional peer range says `^7 \|\| ^8`; the provider only calls `createTransport`, which v10 keeps, and RestoMatch overrides `sendVerificationRequest` anyway (Resend / dev log). Magic-link login re-verified end-to-end. | apps/web |
| sharp | override `^0.35.5` (GHSA-wq5f-xc86-pv6w) | apps/web › next |
| @xmldom/xmldom, brace-expansion, compression, fast-uri, js-yaml, source-map-js, undici | semver-scoped `pnpm.overrides` to the patched release **within the same major** | apps/mobile › expo / react-native tooling |

Newly **baselined** (no patched release exists; Expo CLI dev tooling only, never shipped in the
web/worker runtime):

| GHSA | Package | Sev | Why acceptable |
|---|---|---|---|
| GHSA-vfj7-8cjw-p6xm | braces ≤3.0.3 | high | `apps/mobile › expo › @expo/cli › fast-glob › micromatch` — glob expansion of developer-controlled patterns at build time. |
| GHSA-86w9-cpqp-85rv | node-forge ≤1.4.0 | high | `apps/mobile › expo › @expo/cli` — local dev-server certificate tooling; no signature verification of untrusted input in production. |

Result: `pnpm audit --prod --audit-level=high` → 0 unignored high/critical (117 → 35 total findings).

## 2026-10-24 refresh (post-demo)

Two new advisories turned the gate red on every branch:

| Package | Fix |
|---|---|
| next | **Fixed**: `apps/web` `next` + `eslint-config-next` 15.5.25 → **15.5.28** (GHSA-2464-fhr4-w9xw **critical**: unauthenticated RCE in the Image Optimization API with SVG; GHSA-p3m5-59mp-jv5r high: Server Actions DoS). Production ran the vulnerable version until this lands. |

Newly **baselined** (no patched release in the major we use):

| GHSA | Package | Sev | Why acceptable, and until when |
|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 | zod <4.6.6 (we use ^3.24.1; the only fix is zod ≥4.6.6) | high | Memory exhaustion while validating *oversized constrained collections*. On `main` the only unauthenticated tRPC procedures are `leads.*` and `plans.*`, whose inputs contain no arrays/records/sets/maps; every other input needs a session, and Vercel caps request bodies at 4.5 MB. **Expires with the zod 4 migration** (tracked follow-up). Any new public endpoint that validates a collection must cap the raw body size before zod parses it, or this exception no longer holds. **Wave-1 public zod inputs (checked at the wave-1 integration):** `growth.pricing` (public tRPC query; `{cycle, branches}` scalars only, no collections); `/api/ingest/whatsapp/[token]` and `/api/ingest/email` (zod parses the payload's arrays only *after* the raw body is read with a hard cap — `INGEST_LIMITS.whatsappBodyBytes` 256 KB / `emailBodyBytes` 20 MB, `packages/api/src/ingest/http.ts` `readBody` → 413 — and after the X-Hub-Signature-256 / Standard-Webhooks HMAC check; every array in `packages/ingest/src/payloads.ts` is also `.max()`-bounded). The public leak check (`/api/leak-check/*`) does not use zod (body capped at `MAX_BODY_BYTES` 4.4 MB). |


## 2026-10-31 refresh (pre-pilot)

Six new high advisories, all reached only through the frozen `apps/mobile` Expo tree (owner decision 2026-10-25: the old mobile app is frozen; it is not deployed), turned the gate red on every branch:

| Package | Fix |
|---|---|
| node-forge ≤1.4.0 (via `expo` → `@expo/cli`): GHSA-7wch-p9px-956x, GHSA-jc66-7q78-782g, GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx, GHSA-5x38-2vff-x55p | **Fixed**: `pnpm.overrides` `node-forge@<1.4.1` → `^1.4.1` (resolves 1.4.2, a patch release). |

Newly **baselined**:

| GHSA | Package | Sev | Why acceptable, and until when |
|---|---|---|---|
| GHSA-qr28-fpjm-wq7f | decode-uri-component ≤0.5.0 (via `expo-router` → `query-string@7`) | high | The only fix is 0.5.1, which is ESM-only, while its consumer `query-string@7` is CommonJS. Forcing it would risk breaking the Expo router at runtime for no deployed benefit. Reached only through the frozen `apps/mobile` app, which is not in the deployed surface. **Expires** when `apps/mobile` is removed or unfrozen (then upgrade `expo-router`). |
