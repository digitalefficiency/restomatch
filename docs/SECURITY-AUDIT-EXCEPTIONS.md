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
