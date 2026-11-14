# Execution plan: wave 2 (remaining), wave 3 and wave 4

Written Sat 7.11.2026 for the orchestrator (`session_015veCjPjLCiZbqnYFJpdzvR`). Revised the same day after review (see **Changes after review** at the end). The inputs were four read-only maps (`map_w2.md`, `map_w3.md`, `map_w4.md`, `map_paths.md` in this folder) and `origin/main` = `4c887688` (train A, live). Binding sources: `AGENTS.md`, the wave-2 kit (`docs/ux/wave2/README.md` §7, §8, §12, §13; the newer copy is on `origin/claude/wave2-kit-terms-flags`, which is the head of #226 and reaches main with train B), `docs/ux/IMPLEMENTATION-PLAN.md` §4–§6 and `docs/ux/wave2/ref/MASTER-PLAN.he.md` §1, §5.

Owner instruction (7.11): a full run of waves 2, 3 and 4, "horizontal, efficient and correct". Constraints:
- at most 8 build sessions at once;
- one package = one session = one brief;
- two running packages never own overlapping paths;
- human-PR packages are proposals the owner approves through a Hebrew summary;
- nothing merges to `main` before Thu 12.11 except train B (Tue 10.11 09:00 IL);
- the weekly usage window (it began about 7.11 06:00Z and resets about 14.11 06:00Z) must also cover the pilot: train B on Tue, go-live at ציקטי on Wed 11.11.

Two deploy facts the whole plan builds on:
- **Vercel** builds every `main` commit, but nothing reaches production until Rom promotes it by hand (`docs/ops/PROMOTE-ROLLBACK.he.md:7`).
- **Supabase** applies new migrations to the production DB **at the moment of the merge to `main`** (GitHub integration, `docs/SUPABASE-GITHUB-DEPLOY.md:109`). A schema PR's merge *is* its deploy.

---

## 0. In one screen

- **Critical path:**
  1. `G-03ʰ → H-03ʰ` (schema proposals, from today) → owner review (≤15.11).
  2. Both schema PRs merge **Tue 24.11 09:00 IL**, after a backup and the 2nd human gate. They are their own PRs, not part of a Thursday train, because the merge applies the migrations.
  3. `W2-03` merges in γ (Thu 26.11). "סמן כשולם" opens after the Tue 1.12 deploy.
  4. In parallel: `W2-01` (α, merged Mon 16.11), `W2-13` (γ) and `W2-08` (starts Tue 10.11, aims for γ 26.11, falls back to δ 3.12). Together these open the **wave-3 gate on Thu 26.11** (3.12 if W2-08 slips).
  5. Then `G-14ʰ`: new-files slice from ~24.11, edits to existing charts files once #196 is frozen in γ, review 6–17.12, merge ~17.12 → `H-07ʰ` (~31.12; it carries its own `cron.ts` line) → `W3-08` / `W3-11` (≤14.1) → `G-16` (last in wave 3) → `W4-01` (17–28.1) → `H-09ʰ` (≤30.1).
- **The blocker nobody had started:** G-03ʰ (schema batch 0) has no brief, branch or PR, and nothing on `main` carries its columns. Today it gets its brief (§5.1), written on a new docs branch `claude/wave2-kit-addendum-0711` (never on the #226 head), and a session in slot 2. H-03ʰ follows in the same slot, in its own session, once G-03's migration number is fixed.
- **W-a is already at or over 8 sessions.** Train-B sessions are still active: 13 pilot PRs were updated between 06:21 and 08:25Z today, G-08's round-7 verdict is pending, and #234 and #235 are live. So **start only four packages today**, all path-disjoint from each other, from every open PR and from train B:
  - G-03ʰ, then H-03ʰ;
  - G-10;
  - G-11;
  - W2-12.
  - W2-09c keeps running in its existing session. One slot stays reserved for the pilot.
  - **Check the weekly usage % on Sun 8.11 evening** before adding anything.
- **Starting Tue 10.11, after train B is on `main`:**
  - W2-03 (first commit publishes `computeDueDate`);
  - W2-08 (critical path; its train-B collisions end Tue);
  - W2-07 (base `rw2-β0`, which carries #185 and #189);
  - the short wakes that rebase W2-01, G-07, W2-13 and W2-06.
- **Starting Thu 12.11:** W2-11 (base `rw2-α`, because it codes against #182 and #188), G-09 round 5 (only after #199 is rebased) and the G-04 addendum. W2-14 starts Sat 14.11 after the reset. W2-05 slice C takes the next free slot.
- **First wave-3 start:** G-15ʰ on Sat 14.11, after the usage reset. W3-04a follows on Tue 17.11. W3-02a starts only once W2-16b's recipes rows are GREEN (~21.11). Every wave-3 start is a draft until the gate, and every one is listed in owner approval 11.
- **Integration:**
  - one staging branch per train: `release/wave-2-alpha` (frozen at tag `rw2-α` on Tue 10.11), `release/wave-2-beta` (cut from `rw2-α`), and so on;
  - trains: **α merges Mon 16.11 ~18:00 IL** (so `main` = production through the first pilot week), **β Thu 19.11**, **schema Tue 24.11**, **γ Thu 26.11**, **δ Thu 3.12**, **ε ~10.12**;
  - after each train merges, the orchestrator **merges `main` back** into the next train's branch. Never fast-forward;
  - production deploys on Tuesdays: 17.11, 24.11 (+ schema), 1.12, 8.12, 15.12;
  - wave 3 integrates on `release/wave-3`, cut at the gate (target 26.11). G-14 merges first;
  - wave 4 runs 17–30.1.
- **Automation track (AU-xx):** it shares the same 8 slots, at most 2 AU sessions until 3.12 and at most 3 in December. The first two slots that free after 23.11 go to AU-07, then AU-01. #235 (`ca8f3993`) already keeps the AU files in `docs/ux/automation/`, so nothing needs to move. But its README §10 still says "At most 8 AU sessions at a time" and Phase A "6 at once". **The research session amends that before any AU session starts.**

---

## 1. State on 7.11 (what the plan builds on)

- Nothing from wave 2 is on `main`.
  - 33 wave-2 PRs are open. 28 are green on their head commit.
  - Reds:
    - #182 G-07, #212 W2-13 and #214 W2-15-fix are clock-only. The tz class is fixed by #227 in train B, and the red clears on the next push.
    - #184 W2-06 is red by design: the COVERAGE completeness check fails until #180 W2-01 is on its base.
  - Every CI result ran on an old base (`release/wave-1-clean`), so every PR must re-run after its rebase.
- **They conflict with `main` 4c887688:**
  - #182 (`trpc.ts`), #184 (orders ×5), #190 (`ocrInvoice.ts`, `ocrSweep.ts`), #194 / #197 (recovery);
  - #195 (`ask/tools.ts`), #199 (`ocrInvoice.ts`), #200 (train B resolves it), #209 (×4), #212 (`components/he.ts`), #217 (`trpc.ts`).
  - Check again after train B moves `main`.
- **Train B is still being built today.**
  - 13 pilot PRs were updated between 06:21 and 08:25Z: #200, #211, #213, #216, #222, #223, #224, #227, #229, #230, #231, #232 and #178.
  - G-08's round-7 verdict is pending. Its local commit `93073b7` is not on any remote branch; the remote head is `b795b3a2`, round 6.
  - #234 (H-02, 07:03Z) and #235 (research, 08:26Z) are live too.
- **Wave-2 work riding in train B:**
  - #200 G-08, #219 G-07 pilot redaction, #222 W2-02 unread invoices, #214 W2-15 lab fix;
  - #226, the kit docs. Its head is `claude/wave2-kit-terms-flags` @ `7da2a29f`. Only that branch has README §13, G-17.md and the addenda in W2-03.md (+5), W2-11.md (+4) and G-04.md (+7). Main 4c887688 has none of them.
  - #190 G-09 was pulled out of train B; its round 5 runs after the pilot.
  - #234 (H-02 pilot legal pages) is not confirmed for train B.
  - W2-16 Batch P (values only) is meant to ride train B; confirm it before staging (§10).
- **Not started:** W2-03, W2-07, W2-08, W2-11, W2-12, W2-14, G-10, G-11, H-03ʰ, G-17, and **G-03ʰ** (which is missing from the kit list).
- **Remaining sub-work in started packages:**
  - W2-05: slice B part 2 (the multi-page chip), slice C and the overlay split;
  - W2-09c (#196);
  - W2-15 final;
  - W2-16b and Batch P (confirm with `session_01T7Gh3AYNYzbo3VUYMTLxVD`);
  - the G-04 addendum;
  - the rest of H-02.
- **Wave 3:** 20 packages (W3-01…W3-11 with W3-07a and W3-07b; H-04/05/06/07/10; G-14ʰ, G-15ʰ, G-16). None has a brief, branch or PR. **Wave 4:** W4-01, H-08ʰ, H-09ʰ, H-11ʰ.
- **No open PR touches `packages/db`.** The last migration on `main` is `0070_inventory_counts`. Numbering: G-03 = 0071, H-03 = 0072, H-04 = 0073, and H-13 (AU) = 0074. These are tentative and renumbered at merge, per the H-03 brief.
- **AU track:** #235 (`ca8f3993`) carries `docs/ux/automation/{README,AU-01…AU-19,H-05a,H-12,H-13}.md` and nothing under `docs/ux/wave3/`.

---

## 2. Phases and dates

### P0 · now → Tue 10.11 09:00 IL: the pilot is protected; branch work only
- **No merge, deploy or production-DB write.** Sessions push only to their own `claude/ux-*` branches and open draft PRs. Vercel builds only `main`; GitHub CI runs on PR pushes (one push per milestone).
- **Sat 7.11 (today), orchestrator first:**
  1. Cut `claude/wave2-kit-addendum-0711` from `main` 4c887688. Write `docs/ux/wave2/G-03.md` (§5.1) there.
  2. On the same branch, add the stacking note to H-03 §3: G-03 takes 0071 and H-03 takes 0072. Open the branch as its own docs PR; it rides α. **Never push to `claude/wave2-kit-terms-flags`:** it is the head of #226, a reviewed train-B PR.
  3. Tell the research session (#235) to amend `docs/ux/automation/README.md` §10 to the shared cap (≤2 AU sessions until 3.12, ≤3 in December, inside the 8 slots), with AU-11 as a W3-09 addendum (§6.4).
- **Then start four sessions** (the slot plan is in §3):
  - G-03ʰ;
  - G-10;
  - G-11;
  - W2-12.
  - W2-09c continues in its own session.
- **Sat–Mon, orchestrator, read-only:**
  1. Run an in-memory `git merge-tree` dry run of the α stack (§4.2) against `main` 4c887688, and again against the train-B staging branch once it exists (Mon evening, task #44).
  2. Write the Hebrew summaries for G-03/H-03 and for the rebased #180.
  3. **Sun 8.11 evening:** check the weekly usage %. Start nothing more until it shows room.
- **Mon 9.11 18:00 → Tue 10.11 ~10:00:** train-B staging and merge. Before 18:00, confirm W2-16 Batch P is in the staging set. Pilot sessions get up to 3 slots. Wave sessions running at that point: at most 4.

### P1 · Tue 10.11 (train B on main) → Thu 3.12: wave 2 integrates
- **Tue 10.11, after the train-B merge and smoke test:**
  1. Cut `release/wave-2-alpha` from `main@B` and assemble α on it.
  2. Freeze it at tag `rw2-α` and open the draft PR `release/wave-2-alpha → main`, which is **not merged** yet.
  3. Cut `release/wave-2-beta` from `rw2-α`. Stage #191 and #189 → #202 there, and tag the result `rw2-β0` (W2-07's base).
  - **β is staged only on `release/wave-2-beta`, never on the α branch.** An integration fix to α is a new commit plus a re-tag (`rw2-α.1`). Sessions based on `rw2-α` rebase only if the fix touches their paths.
- **Wed 11.11 (go-live):** no merges. Integration fixes happen on the branches only.
- **Thu 12.11 morning:** the owner approves α, the re-approved #180 and the G-04 lab before/after (§9). Approvals stay off go-live day.
- **Mon 16.11 ~18:00 IL: the human merges α.** The deploy (promote) is Tue 17.11 after the canary. Until then `main` = production, so a pilot P0 hot-fix on 12–16.11 ships on `main@B` alone (§4.1).
- **Thu 19.11:** β merges. **Tue 24.11 09:00:** the G-03 and H-03 schema PRs merge, and that merge is the migration deploy. **Thu 26.11:** γ. **Thu 3.12:** δ.
- **Pre-integrated before 16.11, without touching main:**
  - α in full (steps 1–3) on `release/wave-2-alpha`;
  - on `release/wave-2-beta`: #191 W2-09b, #189 → #202, #184 after its rebase (it goes green there because #180 is on the base), #199 after its rebase (Thu 12.11 morning), and G-10 and G-11 if they are green.
  - γ is only *dry-run* (`merge-tree`, in memory) to surface the known semantic conflicts early: W2-04 before W2-02 on `match.ts`, #212 `persist.ts` against #211's MISSING_ON_INVOICE exclusion, and #194/#197 against train A's W1-08.

### P2 · wave 3: early slices 14.11 → gate (target Thu 26.11), close Sat 16.1
- **Early starts are path-free slices,** drafts only. Each one is listed by name in owner approval 11:
  - G-15ʰ on Sat 14.11;
  - W3-04a on Tue 17.11;
  - W3-02a on ~21.11, after W2-16b's recipes rows are GREEN;
  - from ~23.11, as slots free: W3-05a, W3-06a, H-04ʰ (a draft from IMPLEMENTATION-PLAN:605 without the PIN; field-list addendum commits follow) and W3-07a-1 (after AU-01 and AU-07 are GREEN);
  - ~24.11: the G-14ʰ new-files slice;
  - ~1.12 (after the gate if W2-08 made γ): W3-10, W3-02b, W3-07b and the W3-01 matrix; then W3-05b, W3-07a-2 and W3-03a as slots free.
- **Lane rule:** a wave-3 package starts in an area only once:
  - that area's wave-2 owner is GREEN and integrated on its train branch;
  - W2-16b's copy rows for that area are GREEN (recipes → W3-02, admin → W3-07a, catalog/products → W3-10, chain/branches → W3-01, auth/onboarding → W3-07b, reports → W3-08);
  - the AU hook in between has merged, or is folded in as an addendum (§6.4).
- **Merge order** (MASTER §5) on `release/wave-3`, trains on Thursdays, deploys on the next Tuesday:
  1. **W3-α 17.12** (deploy 22.12):
     - G-14ʰ;
     - the AU hand-offs AU-01, AU-07, AU-04 and AU-02;
     - the independent slices W3-04a, W3-02a, W3-05a, W3-07a-1 and W3-06a;
     - H-10ʰ if decided.
     - H-04ʰ (without its CHECK) is a schema PR. It merges on the deploy Tuesday, 22.12 09:00, with a backup and the 2nd gate, not inside the Thursday train.
  2. **W3-β 24.12** (deploy 29.12):
     - G-15ʰ (+ its one `persist.ts` basis line);
     - W3-10, W3-02b, W3-05b, W3-07a-2, W3-07b, W3-09 (+ the AU-11 addendum) and W3-03;
     - the AU hand-offs AU-03, AU-06, AU-08, AU-10, AU-13 and AU-14.
  3. **W3-γ 31.12** (deploy Tue 5.1): H-07ʰ (+ its `cron.ts` line), W3-01, W3-08, W3-04b, W3-06b, AU-09, AU-12 and AU-15.
  4. **W3-δ 14.1** (deploy 19.1): W3-11 → H-05ʰ (+ H-05a) → H-06ʰ → G-16 (last). The H-04 CHECK commit is a schema merge on Tue 19.1, after H-05.
- **Wave-3 exit:**
  - the money states sum to the hero figure, to the agora;
  - one effect per decision across all 8 readers;
  - a closed month never restates (the H-07 snapshot of December runs on Tue 5.1, catch-up mode);
  - G-16 is green in warn mode.

### P3 · wave 4: Sun 17.1 → Sat 30.1
- **Gate:** every wave-3 agent package is merged.
- **W4-01 runs solo on `apps/web`.** Its paths are a superset of every web package, so no other web session runs beside it.
- **Server-side human PRs beside it:**
  - H-08ʰ (`packages/matching/**`): after G-15 is merged and H-04 is deployed. It may fold into G-15 (MASTER risk #1). AU-09 hands the consolidated accept path to it.
  - H-11ʰ (`owner.ts` + attack assertions): after G-14 releases `owner.ts`, and after the owner confirms decisions 6 and 12 (approval 12).
- **Merge order:** W4-01 → H-08 → H-11 → H-09ʰ (last; it makes the W4-01 and G-16 checks blocking in CI). Deploy Tue 2.2.
- **AU phase C** (AU-16…19, H-12ʰ, H-13ʰ) runs server-side only while W4-01 holds `apps/web`. Its UI parts come after 30.1. H-13ʰ is a schema PR: it merges on a deploy Tuesday.

---

## 3. Concurrency schedule (at most 8 build sessions; pilot sessions count only while active)

**Counting rules:**
- A slot is occupied while a session works.
- A GREEN or drafted session that waits costs nothing and frees its slot. It wakes on a message.
- **GREEN-pending-#180** counts as GREEN for slot purposes. A session whose only red is the COVERAGE completeness check (its `coverage/<ID>.ts` entries are waiting for #180 on its base) pushes once, reports `[ID] GREEN-pending-#180`, and idles until the rebase. Completeness-only red does not count against the self-repair cap of 2.
- Human-PR sessions free their slot as soon as the proposal is drafted.
- The orchestrator does not count as a slot, but its integration work is budgeted (§7).
- **Short wakes** (rebase, one push) run one at a time in a dedicated "short-wake lane" slot. The orchestrator resolves mechanical conflicts itself during integration and wakes the owning session only for semantic ones.
- **Path locks on hot files** (Appendix B) are granted by the orchestrator. A session never edits a hot file it does not hold.
- **The pilot preempts.** When a pilot session is paged and no slot is free, the newest non-critical wave session pauses (§7 order).

| Window | Slots in use | Sessions (✱ = new start) |
|---|---|---|
| **W-a** Sat 7.11 → Mon 9.11 18:00 | at or over 8 with the live train-B sessions | **Wave (5):** 1 W2-09c (existing) · 2 ✱G-03ʰ, then ✱H-03ʰ (serial, same slot; frees once drafted, target Mon midday) · 3 ✱G-10 · 4 ✱G-11 · 5 ✱W2-12. **Pilot / train B (live):** G-08 round 7, #216, #224/#232, #211/#213, #223, #227, #229–#231, #178, #222; H-02 #234 (W1-12); research #235. **No further starts.** Usage check Sun 8.11 evening. If a pilot session is paged and the count is over 8, W2-12 pauses first |
| **W-b** Mon 9.11 18:00 → Tue 10.11 ~10:00 (train-B staging + merge) | ≤8 | 1–3 pilot (paged as needed: G-08 round-7 verify, S2 #216, S13/S14 #224/#232; W1-08/W1-11/W2-02 only if paged) · 4 W2-09c · 5 W2-12 (GREEN-pending-#180 or idle) · 6 reserve. G-03/H-03, G-10 and G-11 are drafted or GREEN and idle |
| **W-c** Tue 10.11 ~10:00 → Wed 11.11 24:00 (train B on main; α frozen; go-live Wed) | 8 | 1–2 pilot on call · 3 short-wake lane: W2-01 #180 rebase (adds train A + B procedures to `BASE_COVERAGE`) → G-07 #182 rebase + alignment to #219 → W2-13 #212 push → W2-06 #184 rebase onto W1-11 (the orchestrator stages #189/#202 itself) · 4 ✱W2-03 (`main@B`, or `rw2-α` if tagged first) · 5 ✱W2-08 (`main@B`; first commit = all 7 badge keys) · 6 ✱W2-07 (`rw2-β0`, Tue afternoon) · 7 W2-09c, then free · 8 W2-12 (rebases onto `rw2-α` Wed). A 3rd pilot session pauses W2-12 |
| **W-d** Thu 12.11 → Sat 14.11 06:00Z (α approved; tail of the usage window) | 8 | 1 pilot on call · 2 short-wake lane: **G-06 #199 rebase first, Thu morning** (`ocrInvoice.ts`; #231 recipients; staged on β) → W2-02 #217 rebase (`trpc.ts`) → W2-04 #209 / W2-10 #194 #197 rebases (semantic parts only) · 3 W2-03 · 4 W2-08 · 5 W2-07 · 6 ✱W2-11 (`rw2-α`) · 7 G-09 round 5 (existing session; starts after #199 is staged; takes the `ocrInvoice.ts` lock from G-06) · 8 W2-12 → the G-04 addendum (existing session, once W2-12 is GREEN-pending). **W2-14 waits for the reset** (Sat 14.11). W2-05 slice C waits for the next free slot |
| **W-e** Sat 14.11 → Sun 22.11 (new usage window; α merges Mon 16.11 ~18:00, deploys Tue 17.11; β merges Thu 19.11) | 8 | W2-03 (→ GREEN ~16.11) → ✱W3-04a (Tue 17.11) · W2-08 · W2-07 (→ GREEN ~17.11) → W2-05 slice C + overlay split · W2-11 (→ GREEN ~18.11) → H-02 rest (W1-12 session, stacked on #234, after G-11 GREEN) · G-04 addendum (→ ~15.11) → ✱W2-16b (Mon 16.11; base `release/wave-2-beta` with G-11 staged; lands its rows in the order recipes → admin → catalog/products → chain/branches → auth/onboarding → reports) · G-09 round 5 (→ GREEN ~15.11) → ✱G-17 (Mon 16.11; gets the `ocrInvoice.ts` lock) · ✱G-15ʰ (Sat 14.11; frees once drafted, ~17.11) → pilot hot-fix reserve · ✱W2-14 (Sat 14.11; `rw2-α`). **✱W3-02a** takes the first slot that frees after W2-16b's recipes rows are GREEN (~21.11) |
| **W-f** Mon 23.11 → Sun 29.11 (schema merges Tue 24.11 09:00; β promoted 24.11; γ merges Thu 26.11 → gate) | ≤8 | **Finishing:** W2-08 (GREEN by ~24.11 for γ), W2-16b, G-17, W2-14, W2-05 C, H-02 rest (drafted, idle). **Running:** W3-04a, W3-02a. **Short-wake lane:** Tue–Wed 24–25.11, the γ rebases that swap interims for the now-deployed G-03 objects (W2-10 `claim_letters`, W2-14 `phone_verified_at` writer, W2-03 short-pay `payment_deductions`, W2-05 C `walk_in`) → Thu–Sun 26–29.11, the four sweep PRs (G-04 `counted_at`, G-05 `idempotency_keys` + `event`, G-06 `skipped`, G-08 `product_aliases.source`), merged in δ. **New, in queue order as slots free:** ✱G-14ʰ new-files slice (~24.11; critical; preempts any non-critical start) · ✱AU-07 (measure first) · ✱AU-01 · ✱W3-05a · ✱H-04ʰ (draft; frees once drafted) · ✱W3-06a · ✱W3-07a-1 (after AU-01 + AU-07 GREEN and W2-16b's admin rows GREEN) · ✱H-10ʰ (only if decided). What doesn't start by 29.11 moves to the head of W-g |
| **W-g** Mon 30.11 → Sun 6.12 (δ merges Thu 3.12) | ≤8, AU ≤2 until 3.12 | **In priority order; never more than 8:** G-14ʰ (existing-file edits on `rw2-γ`) · ✱AU-04 (30.11; L10: must be GREEN and integrated before H-05ʰ and W3-03b start) · ✱AU-02 (30.11; after G-17 releases `ocrInvoice.ts`) · ✱W2-15 final (~1.12; step 8) · ✱W3-10 (after the G-08 sweep PR is GREEN, W2-08 has merged and W2-16b's catalog/products rows are GREEN) · ✱W3-01 matrix slice (after W2-08 has merged and W2-16b's chain/branches rows are GREEN) · ✱W3-07b (after W2-14 has merged in γ and W2-16b's auth/onboarding rows are GREEN) · ✱W3-02b (same W3-02 session, after W3-02a GREEN; W2-07 on main since β). From Thu 3.12 the 3rd AU slot opens: ✱AU-03. **Spills to W-h:** W3-05b, W3-07a-2, W3-03a and any W-f slice not yet started |
| **W-h** 7.12 → 20.12 (G-14 review 6–17.12; W3-α 17.12; H-04 schema merge Tue 22.12) | ≤8, AU ≤3 | Queue: W3-05b · W3-07a-2 · W3-03a, then W3-03b (after W2-05 C is on main and AU-04 is integrated; the ZXing dependency commit only after W2-15 final merges in ε) · ✱W3-09 (+ the AU-11 addendum; after AU-04 is integrated) · ✱W3-08a (after W2-16b's reports rows GREEN) · ✱H-06ʰ · ✱H-05ʰ (after AU-04 is integrated; + the H-05a addendum) · ✱G-16a (guards, warn mode) · W3-06b (after W3-06a GREEN and H-10 decided) · W3-01 scope half. **AU (≤3):** AU-03 → AU-14 · AU-06 · AU-08, then AU-10 (after AU-02 is integrated; must be GREEN before W3-11 starts) and AU-13 (path-disjoint from W3-10) |
| **W-i** 21.12 → 16.1 | ≤8, AU ≤3 | ✱H-07ʰ (after G-14 merges) · ✱W3-11 (≥28.12; after G-14, its W2 owners, AU-02, AU-03 and **AU-10 GREEN**) · W3-08b · G-16b (e2e crawl) · W3-04b (after AU-06) · the remaining W3 slices · **AU:** AU-09 (after G-15 merges in W3-β), AU-12 (after W3-03 merges in W3-β), AU-15 (after W3-10 merges in W3-β), then AU phase B leftovers |
| **W-j** 17.1 → 30.1 | ≤8 | W4-01 (solo on `apps/web`) · H-08ʰ · H-11ʰ · H-09ʰ (last) · AU phase C, server-only |

**Disjointness checks on the risky windows:**
- **W-a:**
  - W2-11 has moved to Thu 12.11. When it starts it still excludes `suppliers/[id]/leak-card*` (W2-09's) and leaves `e2e/supplier-ledger.spec.ts` (#178) until train B is on its base.
  - G-11 leaves `robots.ts` / `sitemap.ts` (#231) until after Tue.
  - **Nobody edits `cross-tenant.attack.test.ts`.** Each new procedure goes into the session's own `coverage/<ID>.ts` from day 1. Only sessions whose base lacks #180 (today W2-12; W2-03/W2-08 only if they start on `main@B`) go GREEN-pending-#180, at the cost of one rebase and one push.
- **W-c / W-d:**
  - W2-08's first commit adds the `badge` key to all 7 unowned route files (`nav/{ask,branches,catalog,chain,products,recipes,reports}.ts`) and then releases them. Wave-3 packages edit those files only on a base that contains W2-08's merge (γ 26.11), or leave them untouched.
  - **`ocrInvoice.ts` order:** #199 (G-06) is rebased first, Thu morning. G-09 r5 starts on top of it, then G-17, then AU-02 → AU-10 → W3-11. G-09 r5 and G-17 never run at the same time.
- **W-e / W-f:**
  - W2-16b excludes `AuthShell.tsx` lines 78–91 (G-11's) and starts only after G-11 is staged.
  - W3-02a starts only after W2-16b's recipes rows are GREEN, and leaves `nav/recipes.ts` alone until W2-08 has merged.
  - W3-07a-1 starts only after **AU-01 and AU-07 are GREEN** and W2-16b's admin rows are GREEN. It leaves `admin/layout.tsx` (G-11) and `admin/automation/**` (AU-07) alone. Fallback, if it must start earlier: it carves out `admin/restaurants/[id]/FeaturesPanel.tsx`, `api/lib/features.ts` and the `admin.automationKpis` procedure in `routers/admin.ts`, and builds its "פיצ׳רים פעילים" view last.
  - The four sweep PRs (G-04, G-05, G-06, G-08) run 26–29.11 in the short-wake lane. **W3-10 starts only once the G-08 sweep (`packages/catalog/**`, `api/catalog/**`) is GREEN.**
  - W2-15 final changes no consumer or showcase file (W2-15.md:55: "no consumer file changes"). Its lint stays at warn. W3 slices on the 5 KpiCard/StatCard routes refresh their own screenshot baselines after ε.

---

## 4. Integration plan (`release/wave-2-*`, then `release/wave-3`)

### 4.1 Mechanics
- **One staging branch per train:** `release/wave-2-alpha`, `-beta`, `-gamma`, `-delta`, `-epsilon`.
  - α is cut Tue 10.11 from `main@B` and **frozen at tag `rw2-α`**. Each later branch is cut from the previous train's tag.
  - The orchestrator alone pushes to them.
  - Sessions never base on another package's branch, except the approved stacks (#194→#193, #197→#194, #198→#185, #202→#189) and the train tags (`rw2-α`, `rw2-β0`, `rw2-γ`…).
  - A tag is never rewritten. A fix is a new commit plus a new tag (`rw2-α.1`).
- **Each train is one PR `release/wave-2-<train> → main`.** The human merges it, in kit step order:
  - α Mon 16.11 ~18:00 IL (the pilot week);
  - β, γ, δ and ε on Thursdays.
  - Human-PR packages (W2-01, H-01, G-13, W2-10a-hpr, H-02) keep their own Hebrew-approved diffs inside the train, with commits unchanged. This follows the train-A #228 precedent.
  - **W2-01's commit is first in history.**
- **Schema PRs are never inside a train.** G-03ʰ, then H-03ʰ (and later H-04ʰ and H-13ʰ) merge as their own PRs on a deploy **Tuesday at 09:00**, after a `pg_dump` backup and the 2nd human gate. The merge applies the migrations through the Supabase integration. App code that reads the new objects ships in a later train.
- **After each train or schema PR merges:** the orchestrator **merges `main` back** into every open `release/wave-2-*` branch (no fast-forward, no rebase of staged commits) and re-tags. Mechanical conflicts are the orchestrator's; semantic ones wake the owning session.
- **Hot-fix path.** Vercel builds every `main` commit, but production changes only on Rom's Promote.
  - **Until α merges (Mon 16.11 ~18:00):** `main` = production. A pilot P0 hot-fix is a normal PR to `main`, promoted after the canary, then merged into every open release branch.
  - **Between a train merge and its Tuesday promote,** a P0 hot-fix either:
    - (a) ships on top of the train, only after the train's canary has passed on the preview build of `main`; or
    - (b) reverts the train's merge commit on `main` (`git revert -m 1`), adds the hot-fix and promotes. The train is re-applied (revert of the revert) on its next train day.
  - Rom decides. The default during the pilot weeks is (b).
  - A schema merge is never reverted (it is additive). Its readers are what get reverted.
- **Before each train PR:**
  1. Run the full gate on the branch: `turbo run typecheck test --concurrency=1`, plus migrate on a fresh DB, `doctor --strict`, `supabase-sync --check` and `check:demo`.
  2. Run every e2e spec that touches a changed route.
  3. Review depth follows risk: two lenses + a verifier for ₪, tenant, auth and money-limit work; one lens for copy or style.
- **Deploys** follow on Tuesday:
  1. canary + numbers canary + logs;
  2. roll back on any anomaly;
  3. **₪-moving changes and data fixes** need a signed before/after report, and ציקטי is told before the deploy:
     - the G-03 legacy backfill (`gr_lines.counted_at`, `count_method='legacy'`; decision 24: a dry-run count on the lab, a read-only count Rom runs on prod, owner approval) → before 24.11;
     - G-04 core → before 17.11;
     - the G-04 `counted_at` durable swap → before 8.12;
     - mark-paid → after 1.12;
     - G-14, H-07.

### 4.2 Trains

| Train | Contents, in this order | Notes |
|---|---|---|
| **α**: PR from `release/wave-2-alpha` @ `rw2-α` (frozen Tue 10.11); approved Thu 12.11 morning; **merged Mon 16.11 ~18:00 IL**; deploy Tue 17.11 | **Step 1:** #180 W2-01ʰ (rebased). **Step 2:** #183 W2-09a · #185 G-05 (a+b) → #198 G-05c · #188 G-04 core (needs the lab before/after signed by Thu 12.11 morning, otherwise α is re-tagged without it and it goes **first in β**; the promote also needs the ציקטי read-only report for 11–16.11, which Rom runs on Mon 16.11) · #182 G-07 (rebased, aligned to #219) · #186 + #203 + #218 W2-15 drafts/fixes · #204 W2-16a · #192 G-12a (after W2-09a + G-07). **Step 3:** #181 H-01ʰ · #187 G-13ʰ (the owner authors the AGENTS.md amendment). **Docs:** the kit addendum PR (`claude/wave2-kit-addendum-0711`: G-03.md, the H-03 §3 note) | Unblocks: every coverage fragment, #184 going green, W2-08 (needs G-12a), all `parseDecimalInput` adopters. Sessions that need α before 16.11 base on `rw2-α` |
| **β**: PR from `release/wave-2-beta` (`main` merged back after α) — **Thu 19.11** (deploy Tue 24.11, after the schema merge) | **G-04 core first, if it left α** (#202's `receiving/deps.ts` swap, W2-07 and W2-11 code against `receiptTruth`) → #191 W2-09b → **Step 4:** #189 W2-05 A → #202 W2-05 B1 → W2-07 · #184 W2-06 (rebased onto W1-11) · #199 G-06 (rebased) · #190 G-09 r5 (only after a double money review; otherwise γ) · G-10 · G-11 | **No schema in β.** G-11 is early because H-02, W2-02 and W2-08 adopt `LegalLinks`. #191 moved up from step 7: it is helpers only and green, and W2-04, W2-08, W2-10 and W2-11 consume it |
| **Schema**: G-03ʰ PR, then H-03ʰ PR (rebased), each straight to `main` — **Tue 24.11 09:00 IL** | Backup → G-03 merge (migrations applied) → `doctor` read-only → H-03 merge → `doctor` → then promote the β build after the canary | Additive; nothing reads them yet. The backfill counts are signed beforehand (approval 1) |
| **γ**: PR from `release/wave-2-gamma` (`main` merged back after β and after the schema) — **Thu 26.11** (deploy Tue 1.12) | **Step 5:** #201 W2-13a → #193 W2-10a-hprʰ (re-applied onto the fragment manifest) + #194 → #209 W2-04 (back-to-back with 10a) → #217 W2-02 (after W2-04's `match.ts`) → #197 W2-10 (swaps to `claim_letters` at its γ rebase) → W2-11 → W2-12 → W2-14 (`phone_verified_at` writer swap) → #212 W2-13 (keeps #211's MISSING_ON_INVOICE exclusion) → W2-16b · W2-05 slice C (`walk_in` swap; + the B2 multi-page chip if G-09 is in β) · the G-04 addendum · #196 W2-09c. **Step 6:** W2-03 (short-pay swap to `payment_deductions`; `PAY_RUN_MARK_PAID` off) → G-17 → **W2-08** (after W2-03; it absorbs the W2-04/W2-02 nav pins merged earlier in this train) | After the 1.12 deploy: mark-paid ON (owner, with its before/after). **If W2-08 lands, the wave-3 gate opens** (W2-01, W2-08, W2-13 and H-03 merged). Cut `release/wave-3` Thu 26.11 |
| **δ**: Thu 3.12 (deploy Tue 8.12) | **Step 7:** #195 G-12b (spans dropped after #196, which merged in γ; rebased onto `ask/tools.ts`) · **the four sweep PRs** (run 26–29.11): G-04 `counted_at` (₪-moving: signed before/after, ציקטי told before 8.12) · G-05 `idempotency_keys` + `event` · G-06 `skipped` · G-08 `product_aliases.source`. **Fallback, if the moves to β/γ didn't happen:** W2-08 → #191 → #196 → #195 | The wave-3 gate opens here if W2-08 slipped. Then cut `release/wave-3` on 3.12 |
| **ε** ~10.12 | **Step 8:** W2-15 final (merges last among the agent packages) · H-02ʰ when counsel signs (it may land later; it is legal text only) | |

### 4.3 Wave 3 and wave 4 trains
These are listed in §2 P2 and P3. `release/wave-3` is cut at the gate (target 26.11). G-14ʰ goes first in W3-α; its review is "the most important in the project", so it runs 6–17.12 with a signed before/after and ציקטי told first. AU packages merge in the train before (or the same train as, and ahead of) the wave-3 successor that takes their files over.

---

## 5. Per-package plan

**Legend:**
- **Base:** `main@4c88` = today's main; `main@B` = after train B (10.11); `rw2-α` = the frozen α tag (10.11; on main from 16.11); `main@α` = after the α merge (Mon 16.11 evening); `rw2-β0` = `rw2-α` + #191 + #189 → #202 staged; `main@β` = after 19.11; `rw2-γ` = the γ tag (~25.11); `rw3` = `release/wave-3`.
- **Merge:** kit step → train.
- **ʰ:** a human PR. The column says what the owner approves.
- **Brief:**
  - ✓ = it exists in the wave-2 kit on main;
  - ✓B = it exists only on the kit branch (#226, train B). The session reads it with `git show origin/claude/wave2-kit-terms-flags:docs/ux/wave2/<file>`, together with README §13, until #226 is on its base;
  - ✗ = it must be written.

### 5.1 Wave 2: new sessions

| Pkg | Start | Base | Interims / stubs it must use | Merge | ʰ · owner approves | Brief |
|---|---|---|---|---|---|---|
| **G-03ʰ** | **now**, slot 2 | main@4c88 | Additive, nullable or defaulted only (GAP-PACKAGES:42-60). Migration `0071` + journal (renumbered at merge); no outbox CHECK (that is H-04). **`supabase/migrations/**` + `supabase/released-migrations.json` only through `pnpm --filter @restomatch/db run supabase-sync`**, never by hand (CI gate `supabase-sync --check`, ci.yml:113-114). `doctor --strict` green (ci.yml:108-109). The 3 new tenant tables (`idempotency_keys`, `claim_letters`, `payment_deductions`) go into the `rls/0002` list (STATE.md:100) **and** get one add-only probe each in `rls.attack.test.ts` (tenant-security-warden reviews). **`users.phone_verified_at`:** the tenant app role has no INSERT/UPDATE/DELETE on `users` (rls.ts:201), so the PR body names the auth/owner connection as the only writer (W2-14). **The legacy backfill** (`gr_lines.counted_at` = the receipt's completion time, `count_method='legacy'`, GAP:47) is a data fix (decision 24): the PR carries a dry-run count of affected lines on the lab DB and the exact read-only count SQL that Rom runs on prod. The PR body lists the first writer of each column. H-03 stacks on its journal, `supabase/` and probe blocks | own schema PR, **merged Tue 24.11 09:00** (= the deploy) | **yes** · the column/table list (counted_at/by/method + legacy backfill, idempotency_keys, PO kind/po_number, delivery_note_number, discrepancies.decision/basis/escalated_*, claim_letters + letter_id, payment_deductions, enum adds `event`/`skipped`, product_aliases.source, users.phone_verified_at), the backfill counts with a signed before/after, and the merge = deploy date | ✗ **write today** on `claude/wave2-kit-addendum-0711` |
| **H-03ʰ** | after G-03 is drafted (Sun/Mon), slot 2 | G-03's proposal branch (stacked) | `0072`; an add-only probe in `rls.attack.test.ts`; `supabase/**` only via supabase-sync; `doctor --strict` | own schema PR, Tue 24.11 right after G-03 | **yes** · its list (paid_*, export_runs, consolidated_invoice_links, leak_month_*, seq_no, address/contact_phone, supplier_bank_accounts + audit, min_order/delivery_fee, line_no ×2, effective_from, push_subscriptions, whatsapp_opt_in, notification_prefs) | ✓ (+ the §3 note on the addendum branch: stacked on G-03) |
| **G-10** | now, slot 3 | main@4c88 | `parseNumberInput` + one `TODO(G-13)`; no tRPC procedure, so no fragment | 4 → β | no | ✓ |
| **G-11** | now, slot 4 | main@4c88 | `LegalShell status='draft'`; robots/sitemap last, after rebasing onto `main@B` (#231) | 4 → β (early) | no | ✓ |
| **W2-12** | now, slot 5 | main@4c88 → rebase onto `rw2-α` Wed 11.11 | Deep link `/dashboard/approvals?invoice=<id>` until W2-04; `PRICE_ALERT_REASONS` off until G-05 (a); `<Money>` + a word until H-01; `parseNumberInput`/`parsePriceCell` + `TODO(G-13)`; `coverage/W2-12.ts` (**GREEN-pending-#180** until the rebase: one push before it, and the completeness-only red doesn't count against the cap) | 5 → γ | no | ✓ |
| **W2-07** | **Tue 10.11** (afternoon) | `rw2-β0` (α with #185's `inventory.sales_set` / `inventory.count_submitted` AuditActions, plus #189 → #202 staged) | First `setSales` + audit (needs #185; never edit `audit.ts`), then the labels, chef redaction, bookkeeper tier and field shell; a local role check until G-07 is on its base; `parseNumberInput` until G-13; the outbox kind (#189 `registerOutboxKind`) and the `receiptTruth` swap (#188) **last**; `coverage/W2-07.ts`; add-only in `inventory-rls.attack` (tenant-security-warden reviews) | 4 → β (after W2-05 A/B1); γ if not GREEN by 17.11 | no | ✓ |
| **W2-11** | **Thu 12.11** | `rw2-α` (#180, #182 G-07, #188 G-04). If G-04 leaves α: `release/wave-2-beta` with G-04 first | `EXISTS match_runs` until G-05; `receiptTruth` (#188) and `ledger.view`/`money.view` (#182); `DrillLink` from #191 at its β rebase; the terms picker writes canonical `מזומן/שוטף/שוטף+N`; `supplier-ledger.spec` after train B | 5 → γ | no | ✓B (+addendum) |
| **W2-03** | **Tue 10.11** after train B | `main@B` (`rw2-α` if tagged first: it carries #180) | **First commit:** `lib/dueDate.ts` `computeDueDate` (G-17 hard-depends on it). `markPaid` behind `PAY_RUN_MARK_PAID` (off) until the H-03 deploy; short-pay hidden until `payment_deductions`, then swapped at its γ rebase (≥24.11); the G-17 flag rendered from a stub `termsCheck` signature; precedence human > agreed > printed; the G-04 `note_billed_twice` hold; `payrun.attack` (warden reviews). **It owns the one claims rule** (`lib/claims.ts` vs recovery `CLAIMABLE_FILTER`), settled with W2-10 by Tue 24.11 and signed by leak-economist and matching-engine-guardian | 6 → γ; flag ON after Tue 1.12 | no (mark-paid ₪ move: owner signs the before/after) | ✓B (+addendum) |
| **W2-08** | **Tue 10.11** (critical path; its train-B collisions with #200/#222 end Tue) | `main@B` → `rw2-α` at its first rebase | **First commit:** the `badge` key on all 7 unowned route files (`nav/{ask,branches,catalog,chain,products,recipes,reports}.ts`), then those files are released. `TaskSource` adapters over today's services; `awaitingDecision` (G-12a) by its one-line swap at the `rw2-α` rebase; `DrillLink` from #191. It absorbs the nav pins (W2-04 approvalInvoice, W2-02 nav:277, W1-11 ordersCapture, G-08 chef catalogMapping), the month-start hero rule (§13) and the W2-16 LeakHero Explain. It holds the `registry.ts` / `nav-registry.test.ts` lock | **aim 7 → γ 26.11 (after W2-03; wave-3 gate)**; fallback δ | no | ✓ |
| **W2-14** | **Sat 14.11** (after the reset) | `rw2-α` | Code against #182/#185; `phoneVerify` off; the `phone_verified_at` writer moves to the durable column at its γ rebase (≥24.11), **on the auth/owner connection only** (the app role cannot update `users`); one assertion flip at `integrations.test.ts:153-170` (approved exception) | 5 → γ | no | ✓ |
| **G-17** | Mon 16.11, after G-09 r5 is GREEN (lock) and W2-03's `dueDate.ts` is pushed | `release/wave-2-beta` after #199 + G-09 r5 are staged | Starts with `packages/ocr` fields, prompt and fixtures + the pure `termsCheck.ts`; the `ocrInvoice.ts` header block last, while it holds the lock. It never writes `invoices.due_date`, has no ₪ and adds no `DiscrepancyType` | 6 → γ (with W2-03) | no | ✓B |

### 5.2 Wave 2: built PRs (wakes only; no new session)

| Pkg / PR | Next action (who, when) | Base for the rebase | Merge | ʰ · owner approves |
|---|---|---|---|---|
| W2-01ʰ #180 | Its session rebases Tue 10.11 (adds train A + B procedures to `BASE_COVERAGE`) | main@B | **1 → α (first)** | yes · re-approve by Thu 12.11 morning: restructured, not weakened |
| H-01ʰ #181 | Retarget only | main@B | 3 → α | approved 31.10; the human merges |
| G-13ʰ #187 | Retarget only | main@B | 3 → α | approved 31.10; **the owner authors the AGENTS.md amendment** (decision 23) |
| W2-10a-hpr #193ʰ | Re-apply onto the fragment manifest after α | rw2-α | 5 → γ (with #194 + W2-04) | yes · re-ack: setup only |
| G-07 #182 | One push + rebase (`trpc.ts` vs W1-11 `chefProcedure`); align to #219; gate the `catalog.items` listPrice hand-off | main@B | 2 → α | no |
| G-05 #185 / #198 | Retarget; #198 after W2-09a. Sweep PR (`idempotency_keys` + `event`) 26–29.11 | main@B / rw2-γ | 2 → α · sweep → δ | no |
| G-04 #188 + addendum + sweep | **Core:** retarget into α; merge gate = the lab before/after signed Thu 12.11 morning; deploy gate = the ציקטי read-only report (11–16.11, run by Rom) signed before the Tue 17.11 promote. Otherwise first in β. **Addendum** (3 consolidated flags): the existing session, Thu 12.11, on `raw.kind` etc. from #224/#232; rebase over #216/#200 `buildMatchInput`; reads G-04.md from the kit branch. **Sweep PR:** `counted_at` durable, 26–29.11 | main@B / rw2-α / rw2-γ | core 2 → α (or first in β) · addendum → γ · sweep → δ | no (₪ move: before/after for core and sweep) |
| W2-09 #183 / #191 / #196 | 09c keeps running; the month-start rule; rebase `owner.ts` over #219. **#191 moves to β** (green, clean, helpers only; consumers W2-04, W2-08, W2-10, W2-11). **#196 moves to γ** and is frozen at the γ assembly (~25.11), which releases the existing charts files to G-14 | main@B | 09a 2 → α · 09b → β · 09c → γ | no (owner acks the step-order change, approval 13) |
| W2-15 #186 / #203 / #218 (+#214 B) + final | Fixes on request. The final PR starts ~1.12; per its brief (W2-15.md:55) it changes no consumer or showcase file, and its lint stays warn | main@B / rw2-δ | 2 → α · final 8 → ε (last) | no |
| W2-16 #204 / 16b / Batch P | 16a retarget. **Batch P: confirm with `session_01T7Gh3AYNYzbo3VUYMTLxVD` before train-B staging, Mon 9.11 18:00.** 16b Mon 16.11 (excludes `AuthShell` 78–91), landing its rows by area in successor order (recipes → admin → catalog/products → chain/branches → auth/onboarding → reports) and reporting each group GREEN. Land `W2-16.md` in the kit | main@B / `release/wave-2-beta` | 16a 2 → α · 16b 5 → γ | no |
| G-12 #192 / #195 | 12a retarget; 12b after #196 (drop spans; #196 merges in γ) + rebase `ask/tools.ts` | main@B | 12a 2 → α · 12b 7 → δ | no |
| W2-05 #189 / #202 / C / B2 | A and B1 staged on β Tue 10.11. Slice C + overlay split from ~17.11 (uses W2-06 `resolveExpectedPrice`; `walk_in` swapped at the γ rebase). **B2 (the multi-page chip) runs in the same session after slice C,** once G-09 r5 is integrated | rw2-β0 / release/wave-2-gamma | 4 → β (A, B1) · C → γ · B2 → γ if G-09 is in β, else δ | no |
| W2-06 #184 | Rebase onto main (W1-11), then green on the β branch | main@B | 4 → β | no |
| G-06 #199 | **First in the short-wake lane, Thu 12.11 morning** (`ocrInvoice.ts`, #231 reserved-TLD skip; `decideLink` hand-off at `:113`), then the lock passes to G-09 r5. Sweep PR (`skipped`) 26–29.11 | main@B / rw2-γ | 4 → β · sweep → δ | no |
| G-09 #190 | Round 5 (HIGH money findings), from Thu 12.11 once #199 is staged; kill switch `settings.features.multiPage` | `release/wave-2-beta` (with #199) | 4 → β or γ | no (double money review) |
| W2-02 #217 (+#222 B) | Rebase (`trpc.ts`); swap `LegalLinks` after G-11; attach/split hidden until G-09 | release/wave-2-gamma | 5 → γ (after W2-04) | no |
| W2-04 #209 | Rebase (`matchInvoice`, recovery, `approvals.ts`) | release/wave-2-gamma | 5 → γ (back-to-back with 10a) | no |
| W2-10 #194 / #197 | Rebase onto W1-08 (7-day overdue, `NEVER_CLAIMABLE`); swap to `claim_letters` at the γ rebase (≥24.11); the one claims rule with W2-03, settled by 24.11 | release/wave-2-gamma | 5 → γ | no |
| W2-13 #201 / #212 | #212 one push + rebase (`components/he.ts`); keep #211's exclusion in `persist.ts` | main@B | 5 → γ (13a first) | no |
| H-02ʰ #234 + rest | **Vehicle:** #234 is H-02 slice 1, and the same (W1-12) session continues the rest after G-11 is GREEN (~18.11), with marked placeholders | #234 branch | 8 → ε / when counsel signs | yes · the legal facts (decision 2), counsel signs every `[לאימות עו״ד]`, the owner or counsel makes the flip-to-approved commit |
| G-08 #200 | Train B, Tue 10.11. Sweep PR (`product_aliases.source`) 26–29.11; it must be GREEN before W3-10 starts | — / rw2-γ | B · sweep → δ | — |

### 5.3 Wave 3 (all briefs ✗ = to write; README in Appendix A)

| Pkg | Start | Base | Interims / stubs | Merge | ʰ · owner approves |
|---|---|---|---|---|---|
| **G-15ʰ** | **Sat 14.11** (first W3 start) | rw2-α | Additive typed `basis` on `MatchOutput`; the 12-type union unchanged; canary and fixtures untouched. `consolidated.ts` only after the G-04 addendum is GREEN; routing parity on train B. **Basis persistence moves here:** one `persist.ts` line writing `discrepancies.basis`, added after G-14 merges (lock W2-13 → G-14 → G-15) | W3-β 24.12 | **yes** · the ₪ meaning diff (leak-economist signs); info rows → acknowledge with no ₪; the pay-approval rule (decision 9) |
| **W3-04** (a palette · b Ask + drafts) | a: Tue 17.11 · b: after AU-06 (≥mid-Dec) | main@α / rw3 | `normalizeHe` published on day 1 (W3-10 needs it); no layout mount (W3-01 gives a slot); the `?` key yields on approvals routes (W2-04 keymap); routes/search add-only; `nav/ask.ts` only after W2-08 has merged | a: W3-α · b: W3-γ | no |
| **W3-02** (a recipes · b inventory + control room) | a: ~21.11, **after W2-16b's recipes rows are GREEN** · b: ~1.12 after W2-07 is on main (β) | main@β / rw3 | `recipes.preview` → `coverage/W3-02.ts`; `parseDecimalInput` (G-13 on main); kitchen-card fields after H-04 (placeholder); `nav/recipes.ts` only after W2-08 has merged | a: W3-α · b: W3-β | no |
| **W3-07a** (1 admin console · 2 integrations + settings) | 1: **after AU-01 + AU-07 are GREEN** and W2-16b's admin rows are GREEN (~26.11) · 2: ~1.12 (after W2-14 has merged in γ) | main@β / rw2-γ | Staged writes with a required reason; excludes `admin/layout.tsx` (G-11), `admin/automation/**` (AU-07) and `settings/automations/**` (AU-01); reuses #177 FeaturesPanel / trial ("פיצ׳רים פעילים" builds on AU-01's FeaturesPanel) | 1: W3-α · 2: W3-β | no |
| **W3-05** (a close checklist · b exports) | a: ~23.11 · b: ~1.12, or W-h if slots are full | main@β / rw2-γ | New `dash/close/**`, `routers/close.ts`; one `registry.ts` line via the orchestrator; steps with no data show T4; `exports.preview` and logged runs after W2-14 + the H-03 deploy | a: W3-α · b: W3-β | no |
| **W3-06** (a pricing/showcase · b rest) | a: ~23.11 (G-11 on main via β) · **b: W-h, after W3-06a GREEN and H-10 decided** | main@β / rw3 | The lead form as a Server Action calls the leads router behind the same guard. **Tenant-security-warden review; human PR if it touches** `leads.ts`, `route.ts` or `rateLimit.ts`. Trial copy waits for H-10 | a: W3-α · b: W3-γ | possibly · any public write path |
| **H-04ʰ** | ~23–26.11, drafted from IMPLEMENTATION-PLAN:605 **without** the PIN/device/sessions rows (decision 13, approval 7); field-list addendum commits when the W3-07b (27.11) and W3-08 (4.12) briefs land. Frees its slot after each commit | H-03's branch → main after 24.11 | `0073`; the outbox CHECK in a separate commit, deployed only after H-05; `supabase/**` via sync; probes add-only | schema PR **Tue 22.12 09:00** (W3-α deploy day; no CHECK); CHECK Tue 19.1 after H-05 | **yes** · the list (saved_views, count fields, waste_entries, kitchen card, billing_mode, opened_at, revised po_lines, notification_seen) |
| **H-10ʰ** | when decision 11's details are given (any free slot) | main | 30-day Pro trial entitlements; check #177. **Adds no migration** (`plans.ts` seed + `packages/billing/**` only); if it needs one, it joins the serial schema lane | **W3-α** if decided by ~10.12 (it unblocks W3-06's trial copy); otherwise W3-δ | **yes** · prices, entitlements, the billing rail |
| **G-14ʰ** | **~24.11: new-files slice** (`charts/src/{leak-ledger,decisions,metrics}.ts` + their tests) · **existing charts files** (`leak-views`, `owner-kpis`, `leaks`, `index`) and `lib/claims.ts` / `persist.ts` / `owner.ts` only after #196 is frozen at the γ assembly (~25.11) | main@β (new files) → rw2-γ (W2-03, W2-09b/c, W2-10, W2-12, W2-13 integrated) | Interim `paid_at` reads the deployed H-03. **Reads `discrepancies.basis` (G-03) as opaque jsonb with a local type;** no import of G-15's unmerged `MatchOutput` change, and no basis write (G-15 adds that line after W3-α). Pre-exports `charts/coverage.ts` for W3-09 | **W3-α first, 17.12** | **yes** · the money-state partition (Σ = hero, to the agora), `DECISION_RULES`/`effectOf` as the only status→₪ map, "caught before payment" via `paid_at`, the METRICS registry; signed before/after; ציקטי told |
| **W3-10** | ~1.12, after the G-08 sweep PR is GREEN, W2-08 has merged and W2-16b's catalog/products rows are GREEN | rw2-γ / rw3 | Takes over G-08's narrow `mapping.ts`/`catalog.ts` and W2-12's `contracts/import/**` (path transfer); `routers/products.ts` after W2-16b's prose rows; ScanButton from W3-03a when it exists; `effective_from` (H-03). AU-15's mapping card arrives as props later (W-i) | W3-β | no |
| **W3-07b** | ~1.12 (W2-14 merged in γ, G-11, #215/#221/#229 on main, W2-16b's auth/onboarding rows GREEN) | rw2-γ / rw3 | `/join`, `/welcome` via a `publicPaths.ts` line (orchestrator); passkeys behind a flag (the package.json line comes from the W3-03 lane); `phone_verified_at` deployed. **`/join/[token]` + its e-mail code is a new public auth write path:** tenant-security-warden reviews; the brief excludes `apps/web/lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts` (risk 14) | W3-β | no (human PR if it needs either excluded file) |
| **W3-01** (matrix · scope) | matrix ~1.12, after W2-08 has merged and W2-16b's chain/branches rows are GREEN · scope after the gate (W-h) | rw3 | Group = billing account (no group table). **`charts/src/chain.ts` is a separate slice co-owned by matching-engine-guardian** (charts SQL; human PR if its ₪ math changes). Pay-run column after AU-14 | W3-γ (after G-14) | no (yes for `chain.ts` if ₪ math changes) |
| **W3-03** (a field cmp · b rest) | a: W-h (`cmp/field/**` new, W2-15 exception) · b: ≥7.12 after W2-05 C is on main and **AU-04 is integrated** | rw3 | BarcodeDetector first; **ZXing in one serialised package.json commit after W2-15 final (ε)**; mock push until H-05 / credentials | W3-β | no |
| **W3-09** (+ AU-11 addendum) | ≥7.12, after W2-06, G-10, G-05 are on main and **AU-04 is integrated** | rw3 | **AU-11 folds in as its addendum slice** (draft builder, `orderReminders.ts` from AU-04, new `orderCutoff.ts`, backorder hook; ocr-procurement-engineer co-owns the worker lines). `po_number`/`kind` (G-03 deployed); `opened_at` after H-04; `DocumentFlow` from W2-02. **New `charts/src/coverage.ts` is a slice co-owned by matching-engine-guardian** (G-14 pre-exports it) | W3-β/γ | no (yes for `coverage.ts` if ₪ math changes) |
| **W3-08** (a tabs · b money) | a: ≥7.12, after W2-16b's reports rows are GREEN · b: after G-14 | rw3 | The only W3 package that edits `msg/index.ts` (adds `reports`); report keys leave `recovery` add-only; excludes `reports/{bidi,money}.ts` (immutable after G-13); `nav/reports.ts` after W2-08 has merged | W3-γ | no |
| **H-06ʰ** | ≥7.12 (W2-10 on main, G-03 deployed) | rw3 | A per-letter token via `claim_letters` or a signed token; `guardPublicRequest` per IP and per token hash; `publicPaths` line | W3-δ | **yes** · the 72 h token, the public route, decision 16 |
| **H-05ʰ** | ≥7.12, after AU-04 is integrated (G-06, W2-13, W2-04, #173 on main) | rw3 | The send path through mocks until Phase-6 credentials; folds the H-05a addendum (AU schedules). **The H-07 close-job registration is no longer in its scope** (H-07 carries it; IMPLEMENTATION-PLAN:606 is amended in the wave-3 README §13) | W3-δ | **yes** · Phase-6 credential intake, templates, quiet hours (decision 14), chase drafts on days 3/7/14 reconciled with the 7-day overdue rule |
| **G-16** (a guards + API invariants · b e2e crawl) | a: ≥7.12 · b: after W2-08 + W2-09 on main | rw3 | Warn mode with per-area counts; eslint rules after W2-15 final | W3-δ (last) | no |
| **H-07ʰ** | after G-14 merges (~21.12) | rw3 | `leak_month_*` (H-03 deployed). **Carries the one `leakMonthClose` registration line in `apps/worker/src/cron.ts`** (immutable; its human PR). W3-γ deploys on Tue 5.1.2027, the 5th itself, so the job's first run snapshots every closed month that has no snapshot yet (catch-up), and the "closed month never restates" check is shown on December | W3-γ 31.12 | **yes** · the hero partition, the funnel, the snapshot on the 5th + dated corrections, the `cron.ts` line; signed before/after |
| **W3-11** | ≥28.12, after G-14 + its W2 owners + AU-02, AU-03 and **AU-10 GREEN** | rw3 | A credit note is never a short-pay; ships a capture component that W3-03 mounts; statement storage has no table (raise as an H-04/H-13 addendum); gets the `ocrInvoice.ts` lock from AU-10 | W3-δ | no |

### 5.4 Wave 4 (briefs ✗; write them in the first week of January)

| Pkg | Start | Base | Notes | Merge | ʰ · owner approves |
|---|---|---|---|---|---|
| W4-01 | Sun 17.1 | main after W3-δ | Solo on `apps/web`; *extends* `e2e/a11y.spec.ts`; excludes `money.ts`, `rateLimit.ts`, `api/trpc/[trpc]/route.ts`; Speed Insights needs a `package.json` path addition | first | no |
| H-08ʰ | ~19.1 | main | After G-15 is merged and H-04 is deployed; may fold into G-15; takes AU-09's accept path | 2nd | **yes** · the ₪-math change + a signed before/after; canary green |
| H-11ʰ | ~19.1 | main | `owner.ts` free after G-14; #219 already strips several procedures; it adds orders.list, catalog listPrice, suppliers.ledger/ledgerGrid, honest typing, FORBIDDEN assertions | 3rd | **yes** · the strip incl. chef exemptions; decisions 6 and 12 confirmed first (approval 12) |
| H-09ʰ | ~26.1 | main | Coordinate with dependabot #31 | last | **yes** · which checks become merge-blocking |

---

## 6. Wave-3 and wave-4 kit work

### 6.1 Briefs to write, in order (only for packages that start in the next 7 days)
1. **`docs/ux/wave2/G-03.md`: today, before slot 2 starts,** on the new branch `claude/wave2-kit-addendum-0711` (its own docs PR, in α). Sources: GAP-PACKAGES:42-60 + H-03 §1 conventions + the §5.1 row above (supabase-sync, `doctor --strict`, the `rls/0002` list, the 3 add-only probes, the `users` writer constraint, the backfill counts). Give it the house template: §1 Start here · §2 Write boundary · §3 Depends on/branch (`claude/ux-g-03-schema-batch-0`) · §4 What to build · §5 Acceptance · §6 Tests · §7 Done · §8 Token notes.
2. **The H-03 §3 amendment,** on the same branch: stacked on G-03, numbering 0071/0072, a rebase over G-03's journal, `supabase/` and probe blocks. Branch `claude/ux-h-03-schema-batch-a` from the G-03 branch.
3. **Session messages, not files:** tell the W2-11, W2-03, G-17 and G-04-addendum sessions to read their brief and README §13 with `git show origin/claude/wave2-kit-terms-flags:docs/ux/wave2/<file>` until #226 is on their base.
4. **`docs/ux/wave3/README.md`: by Fri 13.11** (draft in Appendix A).
5. **`docs/ux/wave3/G-15.md`: by Fri 13.11** (G-15 starts Sat 14.11). Sources: GAP-PACKAGES:222-231, plus the `persist.ts` basis line.
6. **Just outside the 7-day window,** for the 17–21.11 starts: `W3-04.md` and `W3-02.md` by Sun 15.11.
7. **Housekeeping:** copy `W2-16.md` from `claude/ux-w2-16-copy-focus` into the kit (via the addendum branch).

### 6.2 Later briefs (each ≥3 days before its slot, in queue order)
- by 20.11: W3-07a, W3-05, W3-06 (a and b), H-04ʰ (from IMPLEMENTATION-PLAN:605 without the PIN);
- **by 21.11: G-14ʰ** (the most important; its new-files slice starts ~24.11);
- by 27.11: W3-10, W3-07b, W3-01 (with the co-owned `chain.ts` slice), H-10ʰ;
- by 4.12: W3-03, W3-09 (+ the AU-11 addendum and the co-owned `coverage.ts` slice), W3-08, H-05ʰ, H-06ʰ, G-16;
- by 18.12: H-07ʰ (+ the `cron.ts` line and the catch-up rule), W3-11;
- by 8.1: W4-01, H-08ʰ, H-11ʰ, H-09ʰ.

### 6.3 Where the files live
- **`docs/ux/wave3/`** (wave-3 kit):
  - `README.md`;
  - one brief per package: `W3-*.md`, `G-14.md`, `G-15.md`, `G-16.md`, `H-04.md`…`H-07.md`, `H-10.md`.
- **`docs/ux/wave4/`:** `README.md` (short; it points to the wave-3 README) + `W4-01.md`, `H-08.md`, `H-09.md`, `H-11.md`.
- **`docs/ux/automation/`** (the AU track, owned by the research session; already in place on #235 `ca8f3993`):
  - `README.md`;
  - `AU-xx.md`;
  - H-12, H-13 and the H-05a addendum as AU-track human-PR briefs.
- **Orchestrator message to the research session today:** amend `docs/ux/automation/README.md` §10 ("At most 8 AU sessions at a time"; Phase A 16–30.11 "6 at once") to the shared cap of **≤2 AU sessions until 3.12 and ≤3 in December, inside the 8 slots**. Also: reference wave-3 lanes by the hook names in §6.4; AU-11 becomes a W3-09 addendum; AU-13 runs beside W3-10 (path-disjoint); AU-15 runs after W3-10. No AU session starts before the amendment is pushed.

### 6.4 Lanes and named AU hooks (wave-2 owner → AU hook → wave-3 successor)
- **Rule:** an AU package runs *after* the lane's wave-2 owner is GREEN and integrated, and its merge lands *before* the wave-3 successor takes the same files. Where that can't fit, it becomes an addendum slice of the successor. AU sessions count toward the 8 slots: at most 2 run until 3.12 and at most 3 in December. AU merges ride the W3 train ahead of their successor.

| Lane | Wave-2 owner(s) | AU hook (slot) | Wave-3 / wave-4 successor |
|---|---|---|---|
| L1 desk / scope | W2-02, W2-03, W2-04, W2-08 | `⟨AU-hook:payrun⟩` AU-14 (W-h, after W2-03 + the H-03 deploy; W3-β) · `⟨AU-hook:vat⟩` AU-08 (W-h, after W2-02 + W2-08; W3-β) | W3-01 (pay-run column after AU-14) |
| L2 money definitions | W2-03, W2-09, W2-10, W2-12, W2-13 (+G-03/H-03) | `⟨AU-hook:kpi⟩` AU-07 (W-f, first AU slot after 23.11; new `charts/automation.ts`, co-owned by matching-engine-guardian; definitions aligned to G-14/H-07 later; W3-α) | G-14ʰ → H-07ʰ → W3-08b, W3-11; H-11ʰ (W4) |
| L3 kitchen | W2-07 | `⟨AU-hook:prices⟩` AU-13 reads `recipes/alerts.ts` only | W3-02b |
| L4 documents / OCR (`ocrInvoice.ts` lock: G-06 → G-09 r5 → G-17 → AU-02 → AU-10 → W3-11) | G-06, G-09, G-17, W2-02, W2-10, W2-11 | `⟨AU-hook:intake⟩` AU-02 (W-g, 30.11; W3-α) → AU-10 (W-h, after AU-02 is integrated + W2-02; its `crossChannelHold` hook in `ocrInvoice.ts`; W3-β) · `⟨AU-hook:recovery⟩` AU-03 (W-g, from 3.12, after W2-10 + W2-04; W3-β) | W3-11 (≥28.12) |
| L5 catalog / prices | G-08 (B), W2-12 | AU-13 (W-h; path-disjoint from W3-10: `priceAlerts.ts`, `api/priceAlerts/**`; after W2-12 merged in γ; W3-β) · `⟨AU-hook:learn⟩` AU-15 (W-i, after W3-10 merges in W3-β; cards as props; W3-γ) | W3-10 |
| L6 admin | W2-14, G-11 (`admin/layout`), W2-16b (admin copy) | `⟨AU-hook:switch⟩` AU-01 (W-f, second AU slot; `FeaturesPanel` PILOT_DEFAULTS, `features.ts` `OWNER_TOGGLEABLE`, `pilot-config.ts`; the `settings/automations/**` subfolder after W2-14 merges; W3-α) · AU-07 page in the `admin/automation/**` carve-out + `admin.automationKpis` | W3-07a-1 (**after AU-01 + AU-07 GREEN**), W3-05b, W3-07b |
| L7 marketing / legal | G-11, H-02 | — | W3-06, W3-07b (`/join`) |
| L8 orders | W2-06, G-10, W2-05 (receiving router) | `⟨AU-hook:orders⟩` **AU-11 = an addendum slice of W3-09** (needs W2-06 + AU-04 merged) | W3-09 (after AU-04 is integrated) |
| L9 Ask | G-12b | `⟨AU-hook:ask⟩` AU-06 (W-h, after G-12b merged in δ; W3-β) | W3-04b |
| L10 delivery | G-06, W2-13, W2-04, #173 | `⟨AU-hook:briefs⟩` AU-04 (W-g, **30.11, first December-lane AU slot**; W3-α) → AU-12 (W-i, after W3-03 merges in W3-β; W3-γ) | H-05ʰ and W3-03b start only after AU-04 is integrated → H-04 CHECK → H-06ʰ → AU-17 |
| L11 field | W2-05 C, W2-15 final (`package.json`) | AU-12's digest preview hands over to W3-03 after W3-03 has merged | W3-03 |
| L12 schema (strictly serial: `schema.ts`, `drizzle/**`, RLS files, `supabase/**`) | G-03ʰ → H-03ʰ (Tue 24.11) | — | H-04ʰ (Tue 22.12) → H-13ʰ (AU) |
| L13 engine (`consolidated.ts`, `engine.ts`, `approvals/engine.ts`) | G-04 addendum | `⟨AU-hook:consolidated⟩` AU-09 (W-i, after G-15 merges in W3-β; W3-γ) | G-15ʰ → H-12ʰ (AU, `approvals/engine.ts`) → H-08ʰ (W4) |
| L14 guards | W2-15 (`eslint`), W2-08/W2-09 | — | G-16 → W4-01 → H-09ʰ |
| free | — | AU-16/17/18/19 (phase C, from Jan) | H-06ʰ, H-10ʰ |

**AU concurrency check:**
- Until 3.12: at most AU-07 + AU-01 in W-f, then AU-04 + AU-02 from 30.11, once AU-01/AU-07 are GREEN.
- December, at most 3 at once: AU-04, AU-02, AU-03, then AU-14, AU-06, AU-08, AU-10 and AU-13, as each goes GREEN.
- January: AU-09, AU-12, AU-15, then phase C.

---

## 7. Token-budget guardrail

- **Reserve:** keep **≥25 % of the weekly budget unspent until Thu 12.11 09:00 IL** (train B Tue, go-live Wed, D+1). The pilot always wins a slot. **The current window began about 7.11 06:00Z.** Check the usage % on Sun 8.11 evening before any new start beyond today's four.
- **Spending discipline:**
  - kit §2 rules (read in ranges, targeted tests, logs in files, one push per milestone);
  - no subagents or workflows inside build sessions (one review subagent before the final push);
  - GREEN and GREEN-pending-#180 sessions idle;
  - the orchestrator does mechanical rebases itself rather than waking sessions;
  - planner/reader workflow runs like this one at most once a week.
- **When the weekly-limit status turns to WARNING, pause in this order.** Pausing means a message: `[ID] PAUSE · push WIP at the next green test, then idle`; the state lives on the branch.
  1. **Wave-3 and AU starts:** start nothing new. Park the running W3 slices (W3-04a, W3-02a, W3-05a, W3-06a, W3-07a-1, and later W3-10, W3-01 matrix, W3-07b, W3-02b), G-15ʰ if not yet drafted, H-04ʰ, H-10ʰ, G-16, and any AU-xx.
  2. **Non-gate wave-2 builds:** W2-12, W2-11, W2-07, W2-14, W2-16b, H-02 rest, W2-05 slice C/B2, W2-15 final.
  3. **Then:** the G-04 addendum, G-09 round 5, G-17 (last of these, because W2-03 renders its flag).
  - **Never paused:** pilot sessions and hot-fixes; train-B / α integration; G-03ʰ/H-03ʰ (cheap, critical); the W2-01 rebase; W2-03; W2-08; the G-14ʰ slices.
- **At CRITICAL (~90 %):** only the pilot + the orchestrator. Everything else idles until the reset (~14.11, 21.11, 28.11 at 06:00Z).
- **After a reset:** resume in reverse order, critical path first.

---

## 8. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **G-03 missing** → every durable swap, H-03, W2-03 mark-paid, G-14/G-15/H-06 slip | Brief + session today; H-03 stacked right after; owner review ≤15.11; schema merge (= deploy) Tue 24.11 with a backup + the 2nd gate, before readers; γ packages swap at their γ rebase; four sweep PRs in δ |
| 2 | **Integration conflicts** (11 PRs conflict now; more after train B) | Per-train staging branches from `main@B`; `main` merged back after every train (no fast-forward); a merge-tree dry run before Tue; trains in kit step order; every PR re-runs CI after its rebase; known semantic pairs pre-checked: W2-04 before W2-02 on `match.ts`, #212 keeps #211's exclusion, #194/#197 on W1-08, #182 aligned to #219, #193 re-applied after #180 |
| 3 | **Hot files** (Appendix B) | A single holder per lock, granted by the orchestrator; export/union/flag one-liners (`api/index.ts`, `audit.ts`, `activity.ts`, `errors.ts`, `features.ts`, `registry.ts`, `publicPaths.ts`, `next.config.ts`, seeds) are batched by the orchestrator, never by sessions |
| 4 | **Pilot interference** | Nothing merges to main before 12.11 except train B; **α merges Mon 16.11 evening**, so `main` = production through pilot week 1; the hot-fix path is defined (§4.1); no approvals on go-live day; no production-DB writes by agents (the ציקטי reports are human-run, read-only); schema not before 24.11; ₪-moving changes and data fixes need a signed before/after and ציקטי told first; the pilot preempts the newest wave slot |
| 5 | **Usage limit freeze** (it happened on 1.11) | §7 reserve and pause order; ≤8 slots; only 4 starts today; usage check Sun 8.11 evening; wave-3 starts held until the 14.11 reset |
| 6 | **COVERAGE manifest** (2,661-line hot file) | Nobody edits `cross-tenant.attack.test.ts` except W2-01ʰ / #193 / H-11ʰ; fragments `coverage/<ID>.ts` from day 1; duplicate keys throw; GREEN-pending-#180 status, and completeness-only red is exempt from the self-repair cap |
| 7 | **`ocrInvoice.ts` and `packages/ocr`** (G-06, G-08, G-09, G-17, AU-02, AU-10, W3-11, W3-10) | The lock order G-06 (#199, Thu 12.11 morning) → G-09 r5 → G-17 → AU-02 → AU-10 (`crossChannelHold`) → W3-11; G-17 does its `packages/ocr` part first |
| 8 | **AU track** collides on paths and slots (its README still plans 6 sessions 16–30.11, at most 8 at once) | The research session amends README §10 before any AU start; shared cap ≤2 until 3.12, ≤3 in December; AU-01 and AU-07 run before W3-07a-1; AU-11 folds into W3-09; AU-04 integrated before H-05/W3-03b |
| 9 | **Owner review bandwidth** (W2: 7 human PRs; W3: 7; W4: 3) | Hebrew one-pagers; batched review slots (Sun/Mon); H-04 drafted early so it isn't reviewed in G-14's week; G-15+H-08 may fold; G-14 gets its own week (6–17.12) |
| 10 | **Early wave-3 slices rot** before the gate | Only path-free slices with a single wave-3 owner, each named in approval 11; drafts; rebase once on `rw3`; the gate is pulled to 26.11 if W2-08 makes γ |
| 11 | **Decision conflicts** (H-04 PIN vs kit §7; H-02 vehicle; Batch P unknown; H-11 decisions 6/12) | Owner one-liners §9 (7, 6, 12); the wave-3 README marks 6 and 13 "pending owner"; confirm Batch P before Mon 9.11 18:00 |
| 12 | **Immutable files inside globs** (W3-08 `reports/**`, W4-01 `apps/web/**`, H-05 `notifications/**`) | Briefs list the exclusions explicitly; review checks `git diff --stat` against the immutability list |
| 13 | **Tenant attack suites** owned by makers (payrun, inventory-rls, chain, ingest, public routes) | tenant-security-warden is a named reviewer in those briefs; add-only rule |
| 14 | **W3 public write paths:** the W3-06 Server Action, the H-06 portal, **W3-07b's `/join/[token]` + its e-mail code** (a new public auth write path) | Warden review on all three; the leads router behind the same guard; the W3-06 and W3-07b briefs exclude `apps/web/lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`; human PR if any of `leads.ts`, `route.ts` or `rateLimit.ts` must change |
| 15 | **A schema merge is a production deploy** (Supabase integration on `main`) | G-03/H-03/H-04/H-13 merge as their own PRs on a deploy Tuesday at 09:00, after a backup and the 2nd gate, never inside a Thursday train |
| 16 | **W2-08 in γ is a stretch** (M effort, rebases on almost everything) | Fallback δ 3.12; the gate then opens 3.12; approval 11 already covers the ~1.12 starts as pre-gate drafts |
| 17 | **Charts SQL ownership** (W3-01 `chain.ts`, W3-09 `coverage.ts`, AU-07 `automation.ts`) | Each is a slice co-owned by matching-engine-guardian per the AGENTS.md map, not an orchestrator exception; human PR if its ₪ math changes |

---

## 9. Owner approvals for the next 7 days (Hebrew one-liners)

1. **G-03 + H-03 (by Sun 15.11):** לאשר את רשימת העמודות והטבלאות של "מבנה נתונים 0" ו-"מבנה נתונים A" שבתקציר. המיזוג ביום ג׳ 24.11 בשעה 09:00 הוא גם הפריסה לבסיס הנתונים, ולפניו גיבוי ושער אנושי שני. מילוי ההיסטוריה (`counted_at` מסוג legacy) הוא תיקון נתונים (החלטה 24): ספירת השורות במעבדה, ספירה לקריאה בלבד שרום מריץ בייצור, ודוח "לפני ואחרי" חתום. מודיעים לציקטי לפני 24.11, ושוב לפני 8.12, כשהמעבר ל-`counted_at` משנה את מספר הדליפה. מאשרים לבצע זאת בזמן הפיילוט.
2. **#180 W2-01 (by Thu 12.11 morning):** לאשר מחדש אחרי הריבייס. נוספו רק רשומות כיסוי של רכבות A ו-B, ושום בדיקה לא נמחקה או נחלשה. הוא ממוזג ראשון ברכבת α ביום ב׳ 16.11 בערב.
3. **Train α (by Thu 12.11 morning):** לאשר מיזוג ביום ב׳ 16.11 בסביבות 18:00, בסדר הזה: W2-01, אחריו המאפשרים (W2-09a, G-05, G-04, G-07, טיוטות W2-15, W2-16a, G-12a), ואחריהם H-01 ו-G-13. הפריסה ביום ג׳ 17.11 אחרי בדיקת הקנרית. עד המיזוג, main הוא מה שרץ בייצור, ותיקון דחוף לפיילוט עולה ישירות.
4. **G-04 (lab report by Thu 12.11 morning; ציקטי report by Mon 16.11):** לחתום על דוח "לפני ואחרי" של מספר הדליפה על נתוני המעבדה. ביום ב׳ 16.11 רום מריץ דוח לקריאה בלבד על נתוני ציקטי מ-11.11 עד 16.11. חותמים עליו ומודיעים ללקוח לפני הפריסה ב-17.11. בלי חתימה על דוח המעבדה עד יום ה׳ בבוקר, G-04 יוצא מ-α ועובר להיות הראשון ברכבת β.
5. **G-13 (by Thu 12.11):** לנסח (או לאשר נוסח) לתיקון AGENTS.md: מנתח המספרים וגבול האגורות נכנסים לרשימת הקבצים הנעולים (החלטה 23).
6. **H-02 (by Sun 15.11):** לאשר ש-#234 הוא החלק הראשון של H-02 ושאותו סשן ממשיך את שאר החבילה. לתת את פרטי החברה (החלטה 2), או לאשר להמשיך עם מקומות שמורים מסומנים עד שעו״ד חותם.
7. **Decision 13 (by Sun 15.11):** לאשר שאין PIN ואין "מצב מכשיר". מוציאים את זה מ-H-04 ומ-W3-07b. עד האישור, ההחלטה מסומנת "ממתינה לבעלים" במסמך גל 3.
8. **G-09 #190 (by Thu 12.11):** לאשר שהוא חוזר לסבב 5 מיום ה׳ 12.11, ומתמזג רק אחרי סקירת כסף כפולה, ברכבת β או γ.
9. **Budget (now):** לאשר ש-25% מהמכסה השבועית שמורים לפיילוט עד יום ה׳ 12.11 בשעה 09:00. היום מתחילות רק ארבע חבילות, ובערב יום א׳ 8.11 בודקים את המכסה לפני כל התחלה נוספת. בהתראת מכסה עוצרים קודם את גל 3 והאוטומציות, ואחר כך את החבילות של גל 2 שאינן בנתיב הקריטי.
10. **Automation track (by Sun 15.11):** לאשר שמסלול האוטומציות (AU) חולק את אותן 8 משבצות. לכל היותר שתי משבצות עד 3.12 ושלוש בדצמבר, והתחלה ב-23.11 עם AU-07 ו-AU-01. AU-11 נכנס כתוספת לחבילה W3-09. מסמך המסלול מתוקן לפני שסשן AU כלשהו מתחיל.
11. **Early wave 3 (by Fri 13.11):** לאשר שהחבילות האלה מתחילות לפני שער גל 3, כטיוטות בלבד עד השער (יעד 26.11, לכל המאוחר 3.12):
    - G-15 (הצעה אנושית למנוע) ב-14.11;
    - W3-04a ב-17.11, ו-W3-02a בסביבות 21.11;
    - W3-05a, W3-06a, H-04 (הצעה אנושית) ו-W3-07a-1 מ-23.11;
    - G-14 (הצעה אנושית; קבצים חדשים בלבד) מ-24.11;
    - אם השער מתעכב: גם W3-10, W3-02b, W3-07b, W3-05b, W3-07a-2, מטריצת W3-01 ו-W3-03a מ-1.12.
12. **H-11 decisions 6 and 12 (by Sun 15.11):** לאשר שהחלטות 6 ו-12 סגורות: למקבל ולשף אין ₪ בצד השרת, השף פטור בהזמנות ובמתכונים, והאפליקציה הישנה מוקפאת. ולהחליט אם להקדים את H-11. עד האישור הן מסומנות "ממתינות לבעלים" במסמך גל 3.
13. **Train order changes (by Fri 13.11, acknowledge):** לאשר שינויי סדר קטנים מול תוכנית המיזוג:
    - W2-09b עובר לרכבת β, ו-W2-09c ו-W2-08 עוברים לרכבת γ, כדי לפתוח את שער גל 3 שבוע מוקדם יותר;
    - H-07 נושא בעצמו את שורת התזמון ב-`cron.ts`, כדי שסגירת דצמבר תרוץ ב-5.1;
    - H-10 יכול להתמזג ב-W3-α אם יוחלט עד 10.12.

---

## 10. Orchestrator checklist (next 7 days, + Mon 16.11)

- **Sat 7.11:**
  1. Cut `claude/wave2-kit-addendum-0711`. Write G-03.md and the H-03 §3 note there, and open it as a docs PR (rides α). Do not push to `claude/wave2-kit-terms-flags` (#226).
  2. Message the research session (#235): amend the AU README §10 caps; AU-11 → W3-09 addendum; no AU start before that.
  3. Start **only** G-03ʰ, G-10, G-11 and W2-12.
  4. Run the merge-tree dry run of α against main.
- **Sun 8.11:**
  1. G-03 is drafted → start H-03ʰ in slot 2.
  2. Write the Hebrew summary for G-03.
  3. **Evening: check the weekly usage %** (the window began ~7.11 06:00Z). Start nothing more if it is tight.
- **Mon 9.11:**
  1. H-03 drafted → send the G-03 + H-03 Hebrew summary.
  2. **Before 18:00:** confirm W2-16 Batch P with `session_01T7Gh3AYNYzbo3VUYMTLxVD` and add it to the train-B staging set.
  3. Dry-run α against train-B staging.
  4. From 18:00: train-B staging (task #44). At most 4 wave sessions active.
- **Tue 10.11:**
  1. Train B merges 09:00 → smoke.
  2. Short wakes: #180, #182.
  3. Cut `release/wave-2-alpha` from `main@B`, assemble α, freeze it at `rw2-α`, and open its draft PR (not merged).
  4. Cut `release/wave-2-beta` from `rw2-α` and stage #191 and #189 → #202 (`rw2-β0`).
  5. Start W2-03 and W2-08 (`main@B`, or `rw2-α` if already tagged) and W2-07 (`rw2-β0`). Tell W2-03 to read its brief and §13 from the kit branch if #226 slipped.
- **Wed 11.11 (go-live):** no merges and no approvals. Integration fixes on the branches only (a fix to α re-tags `rw2-α.1`). #212 push. Rebase W2-12 onto `rw2-α`.
- **Thu 12.11:**
  1. Morning: owner approvals 2, 3, 4 (lab report), 5, 8.
  2. Short-wake lane: **#199 G-06 first** → stage it on β → G-09 r5 starts (it gets the `ocrInvoice.ts` lock). Then #217, #209/#194/#197.
  3. Start W2-11 (`rw2-α`; it reads W2-11.md + §13 from the kit branch), then the G-04 addendum once W2-12 is GREEN-pending (G-04.md from the kit branch).
- **Fri 13.11:**
  1. Write the wave-3 README (6 and 13 marked "pending owner") and G-15.md.
  2. Stage β: #184, G-10, G-11, and W2-07 when it is GREEN.
  3. Owner approvals 11 and 13.
- **Sat 14.11 (after the reset):**
  1. Start G-15ʰ (`rw2-α`) and W2-14 (`rw2-α`).
  2. Write W3-04.md and W3-02.md.
- **Mon 16.11:**
  1. Rom runs the read-only ציקטי report for G-04 (11–16.11), and the owner signs it.
  2. Start G-17 and W2-16b.
  3. **~18:00: the human merges α.** Merge `main` back into `release/wave-2-beta`.
  4. Tue 17.11: canary → promote.

---

## Appendix A · Draft of `docs/ux/wave3/README.md` (same style as the wave-2 kit)

```markdown
# Wave 3: the shared playbook (read this first, once)

## 0. You are here
- You are **one wave-3 package session** for RestoMatch (Hebrew-first RTL B2B web app that catches supplier-invoice leaks in ₪ for Israeli restaurants; Next.js 15 `apps/web`, tRPC `packages/api`, Drizzle + Postgres RLS `packages/db`, engine `packages/matching`, jobs in Vercel `/api/cron/jobs`).
- **Your brief is `docs/ux/wave3/<ID>.md`.** It holds your write boundary, slices, dependencies, interims, acceptance, tests and line pointers. This README is shared by all wave-3 sessions. On package specifics the brief wins; `AGENTS.md` wins over both; `docs/ux/wave2/README.md` §2, §7, §8, §12, §13 bind wherever this file is silent.
- **The orchestrator is `session_015veCjPjLCiZbqnYFJpdzvR`.** It assigns slots, grants hot-file locks, integrates on `release/wave-3`, reviews and merges. You build one package (possibly in slices a/b) on one branch per slice and open **draft** PRs.
- **Timing.** The wave-3 gate is W2-01, W2-08, W2-13 and H-03 merged (target Thu 26.11; at the latest Thu 3.12). Before it, only the early slices named in §10 run, as drafts, each approved by the owner by name. **G-14ʰ merges first in the wave (W3-α, Thu 17.12).** Wave 3 closes Sat 16.1. Merges happen on Thursdays, deploys on Tuesdays. Schema PRs (H-04ʰ, H-13ʰ) merge on a deploy Tuesday at 09:00: the merge applies the migration.
- **Automation track.** `AU-xx` packages live in `docs/ux/automation/`. They wire, schedule and measure what waves 2–3 build, and they run between a lane's wave-2 owner and its wave-3 successor (§12). They share the same 8 session slots.

## 1. First 10 minutes (checklist)
- [ ] Read AGENTS.md (auto-loaded). Then read this README, then your brief §1 "Start here", §2 "Write boundary", §3 "Depends on", §5 "Acceptance".
- [ ] Read `docs/ux/wave2/README.md` §7, §12 and §13 (owner decisions; binding) by line range.
- [ ] `git fetch origin && git switch -c <branch from brief §3> <base from brief §3>`. The base is `origin/main` or `origin/release/wave-3` at the tag your brief names. Never base on another package's branch.
- [ ] Start the lab in the background: `bash docs/ux/wave2/lab.sh <ID>` (`--tests-only` for no-UI packages). Run your targeted tests green **before** changing anything.
- [ ] Put your day-1 requests (path additions, a hot-file lock, an export line, a registry line, `AuditAction` values, a flag) in **one** QUESTION message (§6). Work on the independent parts meanwhile.

## 2. Token-efficiency rules
`docs/ux/wave2/README.md` §2 applies verbatim. Wave-3 additions:
- **Reuse the wave-2 deliverables, never re-implement them:**
  - `DrillLink`, `flags/why.ts` (W2-09b);
  - `<Explain>` + the explain namespace (W2-16);
  - `LegalLinks` + the legal registry (G-11);
  - `awaitingDecision` (G-12a);
  - `computeDueDate` (W2-03), `termsCheck` (G-17);
  - `parseDecimalInput` / `moneyText` (G-13), `formatIls({signDisplay})` (H-01);
  - the transition kernel, `withIdempotency`, domain events and `invoiceStateOf` (G-05);
  - the capabilities (G-07), `receiptTruth` / `PO_MATCHABLE` (G-04), `TaskSource` + `tasks.mine` + nav badges (W2-08);
  - `resolveExpectedPrice` (W2-06), `registerOutboxKind` (W2-05), `notify()` / recipients (G-06), `decideLink` (G-08);
  - COVERAGE fragments `coverage/<ID>.ts` (W2-01).
- A slice is one PR. Between slices your session idles and frees its slot.

## 3. The lab
Same as wave 2 (`docs/ux/wave2/README.md` §3, `lab.sh`, `shot.cjs`). Seeded months: `apps/web/e2e/seededMonth.ts`; Israel-day fixtures `israelToday` / `israelMonth`. Never the UTC day.

## 4. Quality bar
Wave-2 §4 plus the wave-3 exit criteria your package contributes to:
- **Money:** the money states sum to the hero leak to the agora; each decision has one effect across all 8 readers (site, e-mail, WhatsApp, Ask, mobile, report, export, digest); every metric shows the same ₪ everywhere; a closed month never restates.
- **Alerts:** real push only once Phase-6 credentials exist. Until then, mock providers report `skipped`.
- **Tests:** G-16 invariants green in warn mode. The leak canary and both attack suites are always green.
- **₪-moving changes and data fixes** (G-14, H-07, H-08, any backfill) need a signed before/after report, and ציקטי is told before the deploy. A data fix also needs a read-only report and human approval (decision 24).

## 5. Merge protocol
- **Branch:** `claude/ux-<id>[<slice>]-<slug>` (e.g. `claude/ux-w3-02a-recipes-workbench`).
- **Draft PR** `ux(<ID>): <title>`. Body sections as in wave-2 §5, plus **Lane hand-offs** (what the next package in your lane receives).
- **Subscribe to PR activity; self-repair cap 2;** then BLOCKED. A red that is only the COVERAGE completeness check (your fragment waits for a base entry) does not count: report `GREEN-pending-<PR>`.
- **Never merge, deploy, write to a production DB, send real e-mail or WhatsApp, or spend money.** The orchestrator integrates on `release/wave-3` in §10 order.
- **Human-PR (ʰ) packages** draft a proposal branch + a Hebrew summary. The owner approves, and a human merges.

## 6. Communication
As in wave-2 §6: `[<ID>] GREEN|GREEN-pending-<PR>|BLOCKED|QUESTION · PR #<n> · <≤3 lines>` to the orchestrator via `send_message`. No progress chatter.

## 7. Owner decisions (binding)
- Everything in `docs/ux/wave2/README.md` §7, §12 and §13.
- **Decided since:**
  - 7 (the bookkeeper reads everything; account-card edits are audited);
  - 11 (a 30-day Pro trial; the prices and entitlements are still open, H-10ʰ);
  - 12 (the old mobile app is frozen; kit §7);
  - 14 (no alerts 23:00–06:00 or on Shabbat, ≤6 per person per day);
  - 16 (a supplier reminder is a draft sent only on a click).
- **Pending owner** (treat as open until §13 records the confirmation):
  - 6 (receiver and chef see no ₪ server-side; the chef is exempt on `orders.*` and recipes). Kit §7 already holds the UI rule; H-11ʰ's server strip waits for the owner's confirmation;
  - 13 (no PIN and no device mode: H-04 and W3-07b drop them). Kit §7 already says "no PIN"; device mode is confirmed by approval 7. Until then, build nothing that needs either.
- **Still open:** 2 (legal facts; H-02), 15 (right-aligned numbers, 3-user test; W4-01), and the AU defaults D1–D14 (`docs/ux/automation/README.md` §7.2).

## 8. Immutable files: human-authored PR only
- The AGENTS.md list.
- **Plus, once G-13ʰ merges and the owner amends AGENTS.md:** `packages/types/src/{number-input.ts,money/**}` and `packages/api/src/reports/{bidi,money}.ts`.
- **₪ definitions in `packages/charts`** (G-14ʰ, H-07ʰ, and the co-owned `chain.ts` / `coverage.ts` / `automation.ts` slices when their ₪ math changes) are human-PR by the ownership map.
- **Globs never include immutable files:**
  - W3-08 `reports/**` excludes `bidi.ts` and `money.ts`;
  - H-05ʰ owns `outbox.ts` and `cron.ts` as a human PR; H-07ʰ adds one `cron.ts` registration line in its own human PR;
  - W3-06 and W3-07b exclude `lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`;
  - W4-01 excludes `lib/money.ts`, `lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`.
- Attack suites (`*attack*`) are add-only, and tenant-security-warden reviews them.

## 9. Wave-3 ownership ledger (who may edit what)
Abbreviations as in wave-2 §9 (`web/`, `dash/`, `cmp/`, `nav/` = `apps/web/lib/nav/routes/`, `msg/`, `api/`, `wkr/`).

Every package also owns:
- `api/__tests__/coverage/<ID>.ts`;
- `web/e2e/<ID>.spec.ts` and `__screenshots__/<ID>/**`;
- the tests its brief lists.

**Route-folder rule:** owning `dash/<seg>/**` includes `nav/<seg>.ts`, except W3-01's nav core, and only on a base that contains W2-08's merge. Lines in `nav/registry.ts` and `web/lib/publicPaths.ts` come through the orchestrator. Anything not listed is read-only: ask first.

| Pkg | Owns |
|---|---|
| G-14ʰ | new `packages/charts/src/{leak-ledger,decisions,metrics}.ts` (from ~24.11); `charts/src/{leak-views,owner-kpis,leaks,index}.ts` (after #196 is frozen); `api/lib/claims.ts`; `api/match/persist.ts` (no basis write); `api/contracts/overContract.ts`; `api/routers/owner.ts`; its tests; pre-exports `charts/src/coverage.ts` for W3-09. Reads `discrepancies.basis` as opaque jsonb with a local type |
| G-15ʰ | `packages/matching/src/{engine,index}.ts` (additive basis), new `matching/src/__tests__/basis.test.ts`, `api/approvals/engine.ts`, new `api/__tests__/approvals-engine-routing.test.ts`, `api/match/consolidated.ts` (after the G-04 addendum), one basis line in `api/match/persist.ts` (after G-14 merges) |
| G-16 | new `web/e2e/invariants/**`, `web/e2e/helpers.ts`, new `api/__tests__/invariants/**`, new `web/scripts/guards/**`, `web/eslint.config.mjs` (after W2-15 final) |
| H-04ʰ | `packages/db/src/schema.ts`, the next migration + journal, `supabase/**` via sync, the `rls/0002` list, shape tests (serial after H-03) |
| H-05ʰ | `api/notifications/**` (incl. `outbox.ts`), `wkr/src/cron.ts` (after H-07's line), `wkr/src/jobs/{outboxDispatch,recoveryReminders,matchInvoice}.ts` (after AU-04 is integrated) |
| H-06ʰ | new `web/app/s/c/**`, `web/app/api/claims/**`, `api/claimPortal/**`, public-route attack tests |
| H-07ʰ | `charts/src/{leak-hero,leak-report}.ts`, new `wkr/src/jobs/leakMonthClose.ts` (catch-up on first run), one registration line in `wkr/src/cron.ts`, named charts tests |
| H-10ʰ | `packages/db/src/plans.ts`, `packages/billing/**` (no migration) |
| W3-01 | `dash/{chain,branches}/**`, `dash/{branch-switcher.tsx,branch-actions.ts,layout.tsx,nav.tsx}`, `web/lib/nav/**` core + `nav/{chain,branches}.ts`, the branch column/filter only in `dash/{approvals,invoices}/**`, `api/routers/{chain,approvals,payRun,invoices}.ts`, `chain.attack.test.ts`, `msg/{chain,nav}/**`. **`charts/src/chain.ts` is a separate slice co-owned by matching-engine-guardian** |
| W3-02 | `dash/{recipes,inventory}/**`, `nav/{recipes,inventory}.ts`, `api/routers/{recipes,inventory}.ts`, `api/{recipes,inventory}/**` (not `recipes/csv.ts` parsing internals), `recipes*.test.ts`, `msg/{recipes,inventory}/**` (after W2-16b's recipes rows) |
| W3-03 | `web/lib/pwa/**`, `web/public/pwa/**`, `web/app/receiver-sw.js/**`, new `dash/share/**`, `dash/receiving/**`, `showcase/receiver/{_steps/**,_state.ts,_mock.ts}`, new `dash/settings/notifications/**`, new `cmp/field/**`, `web/package.json` + `pnpm-lock.yaml` (**the one dependency commit lane**), `wkr/src/jobs/{dailyExpectations,supplierDelays}.ts` (after AU-04), `api/routers/push.ts`, `msg/{receiving,common}/**` |
| W3-04 | `dash/{search.tsx,searchOptions.ts}`, new `web/lib/hotkeys.ts`, new `cmp/palette/**`, `dash/ask/**`, `api/ask/**` (after AU-06), `api/routers/{ask,search}.ts`, `{ask,search}*.test.ts`, `msg/ask/**` |
| W3-05 | new `dash/close/**`, `dash/exports/**`, `nav/{close,exports}.ts`, `api/routers/{close,exports}.ts`, `api/exports/**`, `exports*.test.ts`, `msg/accounting/**` |
| W3-06 | `web/app/(marketing)/**` except `{privacy,terms,cookies}`, `web/app/page.tsx`, `web/app/showcase/**` except `receiver/{_steps,_state,_mock}`, `web/lib/heroMedia.ts`, `web/public/media/**`, `api/routers/leakCheck.ts`, `msg/{marketing (not legal.*),landing,showcase,leakCheck}/**` |
| W3-07a | `web/app/admin/**` (incl. `layout.tsx` once G-11 has merged; not `admin/automation/**`; `admin/restaurants/[id]/FeaturesPanel.tsx` only after AU-01 is GREEN), `dash/integrations/**`, `dash/settings/**` except `notifications/**` and `automations/**`, `api/routers/{admin,integrations,settings}.ts` (not the `admin.automationKpis` procedure), their tests, `msg/{admin,integrations,settings}/**` |
| W3-07b | `dash/team/**`, `web/app/{login,(auth),invite,onboarding,join,welcome}/**`, `web/auth.ts`, `api/routers/{team,onboarding}.ts`, their tests, `msg/{auth,onboarding,team}/**`, `e2e/{auth,consent-login}.spec.ts`. Excludes `web/lib/rateLimit.ts` and `app/api/trpc/[trpc]/route.ts`; warden reviews `/join` |
| W3-08 | `dash/reports/**`, `api/reports/**` except `{bidi,money}.ts`, `api/routers/monthlyReport.ts`, `nav/reports.ts`, **`msg/index.ts` (only W3-08 in wave 3)** + new `msg/reports/**`, `monthly-report*.test.ts` |
| W3-09 | `web/app/s/**` except `c/**`, `web/app/api/supplier-confirm/**`, `api/supplierConfirm/**`, `api/orders/**`, `api/routers/{orders,receiving}.ts`, `dash/orders/**`, `cmp/documents/**`, `wkr/src/jobs/{syncPlatforms,orderReminders,orderCutoff}.ts` (AU-11 addendum), `{order,supplierConfirm}*.test.ts`, `msg/{supplierConfirm,orders}/**`. **New `charts/src/coverage.ts` is a separate slice co-owned by matching-engine-guardian** |
| W3-10 | `dash/{catalog,products}/**`, `dash/contracts/import/**` + `api/contracts/import.ts` (transferred from W2-12), `api/catalog/**`, `api/routers/{catalog,mapping,products}.ts`, `packages/catalog/**` (after the G-08 sweep), `wkr/src/jobs/importCatalog.ts`, `catalog*.test.ts`, `msg/{catalog,products}/**` |
| W3-11 | `packages/ocr/**` (lock after G-17/AU-02/AU-10), `api/ingest/**`, `dash/{inbox,recovery,leaks/claims}/**`, `dash/suppliers/ledger/**`, `api/routers/{ingest,recovery,suppliers}.ts`, `api/{recovery,ledger}/**`, their tests, `msg/{ingest,recovery,suppliers}/**`; a capture component mounted by W3-03 |

**Hot files** (one holder at a time; the orchestrator grants the lock): see the lock table, Appendix B of the programme plan, copied here at kit time.

## 10. Start order, slices and merge steps (at most 8 sessions at a time, AU included)
**Early slices (drafts before the gate; each one named in the owner's approval):**
- G-15ʰ (14.11);
- W3-04a (17.11); W3-02a (~21.11, after W2-16b's recipes rows);
- W3-05a, W3-06a, H-04ʰ (~23.11); W3-07a-1 (after AU-01 + AU-07 GREEN and W2-16b's admin rows);
- G-14ʰ new-files slice (~24.11, critical);
- W3-10, W3-02b, W3-07b, W3-01 matrix (~1.12, each after its W2-16b rows and W2-08's merge); W3-05b, W3-07a-2, W3-03a as slots free.

**After the gate:**
- W3-03b, W3-09 (+AU-11), H-05ʰ (each after AU-04 is integrated); W3-08a, H-06ʰ, G-16a, W3-06b (≥7.12);
- H-07ʰ, W3-11 (after AU-10), W3-08b, G-16b, W3-04b (after AU-06) (after G-14 merges).

**Merge steps** (MASTER-PLAN §5), Thursday trains on `release/wave-3`:
1. W3-α 17.12: G-14ʰ → AU-01, AU-07, AU-04, AU-02 → the independent slices W3-04a, W3-02a, W3-05a, W3-07a-1, W3-06a → H-10ʰ (if decided). H-04ʰ (no CHECK) merges Tue 22.12 09:00 as a schema PR.
2. W3-β 24.12: G-15ʰ, W3-10, W3-02b, W3-05b, W3-07a-2, W3-07b, W3-09 (+AU-11), W3-03; AU-03, AU-06, AU-08, AU-10, AU-13, AU-14.
3. W3-γ 31.12: H-07ʰ, W3-01, W3-08, W3-04b, W3-06b; AU-09, AU-12, AU-15.
4. W3-δ 14.1: W3-11 → H-05ʰ (+H-05a) → H-06ʰ → G-16 last. The H-04 CHECK merges Tue 19.1 as a schema PR.

| Pkg | Start before deps merge? Build against | Step |
|---|---|---|
| (one row per package, from programme plan §5.3) | | |

**Day-1 rule:** publish your dependents' exports in your first commit (e.g. W3-04 `normalizeHe`, W3-03a `ScanButton`, G-14 `charts/coverage.ts`, G-15 the `basis` type).

## 11. Reference copies (read by line range only)
- `docs/ux/IMPLEMENTATION-PLAN.md` §4 (≈520–615, wave 3), §5 (≈616–630, wave 4), §6 (631+).
- `docs/ux/wave2/ref/GAP-PACKAGES.md`: G-14 (201–220), G-15 (222–231), G-16 (233–258); Part B amendments. GAP:207 (G-14 storing G-15's basis) is superseded: G-15 writes that line after W3-α.
- `docs/ux/wave2/ref/MASTER-PLAN.he.md` §1 (critical path), §4 (quality gates), §5 (merge order).

## 12. Automation track hooks (AU-xx, `docs/ux/automation/`)
- **Rule:** an AU package runs after its lane's wave-2 owner is GREEN and integrated, and merges before the wave-3 successor takes the same files; where that can't fit, it is an addendum slice of the successor. It counts toward the 8 slots: at most 2 until 3.12, at most 3 in December.
- **Named hooks:**
  - `⟨AU-hook:switch⟩` AU-01 → W3-07a-1 (after AU-01 GREEN);
  - `⟨AU-hook:kpi⟩` AU-07 → G-14/H-07, W3-07a-1 (`admin/automation/**` carve-out, `admin.automationKpis`);
  - `⟨AU-hook:intake⟩` AU-02 → AU-10 (`crossChannelHold` in `ocrInvoice.ts`) → W3-11;
  - `⟨AU-hook:recovery⟩` AU-03 → W3-11 / H-05;
  - `⟨AU-hook:briefs⟩` AU-04 → AU-12 → H-05 / W3-03 (H-05 and W3-03b start after AU-04 is integrated);
  - `⟨AU-hook:ask⟩` AU-06 → W3-04b;
  - `⟨AU-hook:vat⟩` AU-08 → W3-05;
  - `⟨AU-hook:consolidated⟩` AU-09 (after G-15's `consolidated.ts`) → H-08ʰ;
  - `⟨AU-hook:orders⟩` AU-11 = an addendum slice of W3-09;
  - `⟨AU-hook:prices⟩` AU-13 (beside W3-10, path-disjoint) / `⟨AU-hook:learn⟩` AU-15 (after W3-10 merges) → W3-10's pages by props;
  - `⟨AU-hook:payrun⟩` AU-14 → W3-01;
  - phase C: AU-16 + H-12ʰ/H-13ʰ, AU-17 (after H-05 + H-06), AU-18 (after W3-05 + W3-11), AU-19 (after AU-14).
- **New human PRs from the AU track** follow the same serial lanes:
  - H-12ʰ (`approvals/engine.ts`) goes after G-15;
  - H-13ʰ (schema) goes after H-04, merged on a deploy Tuesday;
  - the H-05a addendum folds into H-05.

## 13. Updates from the orchestrator
- (at kit time) IMPLEMENTATION-PLAN:606 is amended: the registration of the H-07 close job moves from H-05 to H-07's human PR (owner approval 13).
- (binding updates are appended here with a date)
```

---

## Appendix B · Hot-file lock table (one holder at a time)

| File | Holder now → next | Rule |
|---|---|---|
| `api/__tests__/cross-tenant.attack.test.ts` | W2-01ʰ (#180) → #193ʰ (setup) → H-11ʰ (W4) | Everyone else: `coverage/<ID>.ts` only; completeness-only red = GREEN-pending-#180 |
| `api/index.ts` | Orchestrator-serialised export lines (sanctioned: G-06, G-12, W2-13; in flight: W2-04, W2-10, G-08, G-09; AU `appRouter` lines) | Request a line; never edit |
| `api/trpc.ts` | G-07 → (H-11 latent) | — |
| `wkr/src/jobs/ocrInvoice.ts` | G-06 (#199 rebase, Thu 12.11 morning) → G-09 r5 (settle hook) → G-17 (header block) → AU-02 → AU-10 (`crossChannelHold` hook) → W3-11 | A lock; G-17 does `packages/ocr` first |
| `packages/ocr/**` | G-08 (train B, done) → G-17 → AU-02 (checks) → W3-11 (→ W3-10 PDF import) | — |
| `web/lib/nav/registry.ts`, `nav-registry.test.ts`, `web/lib/roles.ts` (generated) | W2-08 → W3-01 | New routes (W3-05 close, W3-03 share/notifications) via orchestrator lines |
| `nav/{ask,branches,catalog,chain,products,recipes,reports}.ts` | W2-08 (badge key, first commit) → released → W3-04 / W3-01 / W3-10 / W3-02 / W3-08 | Wave-3 edits only on a base containing W2-08's merge |
| `msg/index.ts` | W2-13 (+W2-16 #204) → W3-08 → W4-01 | — |
| `msg/{auth,onboarding,admin,recipes,catalog,products,chain,vat}/**` + their copy lines; `routers/{onboarding,admin,products}.ts` prose | W2-16b (rows by area) → W3-07b / W3-07a / W3-02 / W3-10 / W3-01 / AU-08 | Each successor starts after its area's rows are GREEN |
| `web/package.json` + `pnpm-lock.yaml` | W2-15 → W3-03 (one dependency commit per week; passkeys, zip, web-push and Speed Insights request it) | dependabot #233 and #231 rebased by the orchestrator |
| `dash/layout.tsx`, `dash/nav.tsx` | W2-08 → W3-01 | W3-04 palette, W3-03 install sheet and W3-07b welcome mount through W3-01 slots |
| `admin/restaurants/[id]/FeaturesPanel.tsx`, `api/lib/features.ts` (`OWNER_TOGGLEABLE`) | AU-01 → W3-07a-1 | `features.ts` flag lines stay orchestrator-serialised |
| `api/routers/admin.ts` | W2-16b (prose) → AU-07 (`admin.automationKpis`, one procedure) → W3-07a-1 | — |
| `dash/settings/**` | W2-14 → AU-01 (new `settings/automations/**` only, after W2-14 merges) → W3-07a-2 | `settings/notifications/**` → W3-03 |
| `api/routers/owner.ts` | W2-09 → G-14ʰ → H-11ʰ | — |
| `api/lib/claims.ts` | W2-03 → G-14ʰ | **The one claims rule** (W2-03 vs recovery `CLAIMABLE_FILTER`): W2-03 writes it with W2-10, settled in their γ rebases by Tue 24.11, signed by leak-economist + matching-engine-guardian, before G-14's existing-file edits |
| `api/recovery/**` | W2-10 → AU-03 → W3-11 | `claim_letters` swap in W2-10's γ rebase |
| `api/match/persist.ts` | W2-13 → G-14ʰ → G-15ʰ (one basis line, after W3-α) | Keep #211's MISSING_ON_INVOICE exclusion |
| `api/match/consolidated.ts` | G-04 (addendum) → G-15ʰ → AU-09 → H-08ʰ | — |
| `packages/charts/**` | W2-09 (until #196 is frozen in γ) → G-14ʰ (new files from ~24.11; barrel + `leak-*` after #196) · co-owned slices with matching-engine-guardian: W3-01 `chain.ts`, W3-09 `coverage.ts`, AU-07 `automation.ts` (new) · H-07ʰ `leak-hero`/`leak-report` | Human PR if ₪ math changes |
| `packages/catalog/**`, `api/catalog/**` | G-08 (sweep, 26–29.11) → W3-10 | — |
| `packages/matching/**` | G-15ʰ → H-08ʰ | Human PRs only |
| `api/approvals/engine.ts` | G-15ʰ → H-12ʰ (AU) | Human PRs only |
| `api/notifications/**`, `wkr/src/cron.ts` | G-06 / W2-13 / #173 → AU-04 (builders only) → H-07ʰ (one `leakMonthClose` line, W3-γ) → H-05ʰ | Other `cron.ts` registrations (W3-03, W3-09, AU) only via H-05ʰ or H-05a |
| `wkr/src/jobs/{matchInvoice,endOfDayReport}.ts` | W2-04 → AU-04 → H-05ʰ (`matchInvoice`) / AU-12 (`endOfDayReport`) | — |
| `wkr/src/jobs/{dailyExpectations,supplierDelays,orderReminders}.ts` | AU-04 → W3-03 (first two) / W3-09 + AU-11 (`orderReminders`) | — |
| `api/routers/payRun.ts`, `dash/approvals/pay-run/**` | W2-03 → AU-14 (preflight panel) → W3-01 (branch column) | — |
| `packages/db/src/schema.ts`, `packages/db/drizzle/**` (migrations, journal, meta, `rls/`), `packages/db/src/rls.ts`, `supabase/**` | G-03ʰ → H-03ʰ → H-04ʰ → H-13ʰ (strictly serial) | Numbers 0071, 0072, 0073, 0074 (tentative); each merges on a deploy Tuesday 09:00. Outside the lock: `packages/db/src/plans.ts` (H-10ʰ, no migration) and `packages/db/scripts/pilot-config.ts` (AU-01) |
| `api/audit.ts`, `api/activity.ts`, `api/errors.ts`, `web/lib/serverErrors.ts`, `api/lib/features.ts` | Orchestrator-serialised union, flag and error-code lines | Request in the day-1 QUESTION |
| `web/lib/publicPaths.ts` | G-11 → (W3-07b `/join`, `/welcome`; H-06 `/api/claims`) via orchestrator | — |
| `web/e2e/helpers.ts`, `prepare-db.ts`, `playwright.config.ts` | G-16 (`helpers.ts` in W3) → W4-01 | Others request |
| `web/eslint.config.mjs` | W2-15 → G-16 → W4-01 | — |
| `web/next.config.ts` | W2-09 (redirects) → orchestrator lines (W3-08 308, W3-03 SW headers) | — |
| `wkr/scripts/seed-*.ts` | One block per package via the orchestrator (G-10 answer block, W2-13 activity inserts) | — |

---

## Changes after review

Every correction was checked against git (`origin/main` 4c887688, the kit branch, the PR branches), the GitHub PR state and the scratch maps before it was applied. Verdicts: **applied** (the correction holds as stated), **applied, with a note** (it holds, but a detail was wrong or needed adjusting) and **partly wrong** (only the part that holds was applied).

1. **Applied.** §2 P1 did pre-stage #189/#202/#184/#199/G-10/G-11 on the same branch as α, and §4.1 told the orchestrator to fast-forward that branch after α's merge commit. The fix:
   - α is frozen at `rw2-α` on `release/wave-2-alpha`, and its PR comes from there;
   - β is staged only on `release/wave-2-beta`;
   - `main` is merged back into the next train's branch after every merge, never fast-forwarded.
   - Changed: §0, §2 P1, §4.1, §4.2, §5 legend, §10.
2. **Applied, with a note.**
   - #226's head is `claude/wave2-kit-terms-flags` @ `7da2a29f` (GitHub). `git diff --stat origin/main origin/claude/wave2-kit-terms-flags -- docs/ux/wave2/` shows README +24 (§13), a new G-17.md, W2-03 +5 and W2-11 +4.
   - **The diff also shows G-04.md +7.** So the G-04-addendum session gets the same "read from the kit branch" instruction.
   - G-03.md and the H-03 note now go on `claude/wave2-kit-addendum-0711`, as their own docs PR in α.
   - Changed: §0, §2 P0, §5 legend, §6.1, §10.
3. **Applied, with a note.**
   - The PR state is as stated: 13 pilot PRs updated 06:21–08:25Z, #234 at 07:03Z, #235 at 08:26Z. `93073b7` is on no remote branch; G-08's remote head is `b795b3a2`, round 6.
   - W2-07: W2-07.md:79/83 require G-05's pre-added AuditActions before `setSales`. They exist only on `claude/ux-g-05-write-kernel` (`audit.ts:93-94`). The outbox kind needs #189 (W2-07.md:74).
   - W2-11 codes against G-04 `receiptTruth` and G-07 `ledger.view`/`money.view` (W2-11.md:71, 87-88).
   - W2-08 can start without G-12a: it is a one-line swap (W2-08.md:85).
   - Adjustments:
     - W2-07's base is `rw2-β0`, which also carries #180, so it is never COVERAGE-red. W2-11's base is `rw2-α`, because α now merges Mon 16.11 (see 17).
     - Moving W2-07 and W2-08 to Tue and W2-11 to Thu put **9** sessions in W-d. So W2-14 moves from Thu 12.11 to Sat 14.11, after the reset.
4. **Applied, with a note.**
   - Approval 4 is now dated off go-live day. Its merge gate is the lab report (Thu 12.11 morning). Its deploy gate is a human-run, read-only ציקטי report on 11–16.11, before the Tue 17.11 promote. If either fails, G-04 core goes **first** in β.
   - Detail: #189 (W2-05 slice A) does not import `receiptTruth`. #202 carries a local stub (`receiving/deps.ts:16 // SWAP: G-04 #188`), and W2-07 and W2-11 code against it. Putting G-04 first is still right.
5. **Applied.** AU-10's `crossChannelHold` hook in `ocrInvoice.ts` is in `docs/ux/automation/README.md` §9 (on #235). The lock chain is now G-06 (#199, Thu morning) → G-09 r5 → G-17 → AU-02 → AU-10 → W3-11. Changed: W-d, §5.2 G-06/G-09, §6.4 L4, risk 7, Appendix B.
6. **Applied, with a note.**
   - Verified: #200's files include `packages/catalog/src/**` and `packages/api/src/catalog/**`; W2-14.md:100/173 write `phone_verified_at`; W2-03.md:33 owns `lib/claims.ts`; #202 owns `routers/receiving.ts`.
   - Detail: #194/#197 (W2-10) do not touch `lib/claims.ts`. W2-10's late sweep would instead have collided with AU-03 and W3-11 on `api/recovery/**`.
   - Either way, the fix holds:
     - W2-10, W2-14, W2-03 and W2-05 C swap at their γ rebase, after the schema merge on 24.11;
     - only G-04, G-05, G-06 and G-08 run sweep PRs, 26–29.11 in W-f, merged in δ;
     - W3-10 waits for the G-08 sweep;
     - W2-14's writer must use the auth/owner connection (see 20).
7. **Applied, with a note.** Decision 24 (kit README:127) requires read-only reports plus human approval for data fixes, but it also says "after the pilot". So approval 1 now asks the owner to allow the backfill *during* the pilot, alongside the lab dry-run count, the prod read-only count (run by Rom), the signed before/after and ציקטי told before 24.11 and 8.12. The backfill rule itself is GAP-PACKAGES:47. Changed: §4.1, §5.1 G-03, §9.1.
8. **Applied, with a note** (the (h) moves).
   - #191 is open, `mergeable_state: clean`, with 9 files, all `apps/web` helpers and no charts. #196's files are `charts/src/leak-views.ts` + its test.
   - Detail: #191's consumers (from its PR body, and the briefs W2-10.md and W2-11.md) are **W2-04, W2-08, W2-10 and W2-11, not W2-02**. Neither W2-02.md nor #217/#222 uses `DrillLink` or `flags/why.ts`.
   - #191 moves to β and #196 to γ. G-14's new-files slice starts ~24.11, and its edits to existing charts files wait until #196 is frozen.
   - Moving steps against MASTER §5 step 7 is put to the owner as approval 13.
9. **Applied.** GAP-PACKAGES:207 (G-14's `persist.ts` "also persisting the engine `basis` from G-15") and G-15 item 1 confirm the problem. G-14 now reads `discrepancies.basis` (a G-03 column) as opaque jsonb with a local type. The basis write moves to G-15's PR, which adds one `persist.ts` line after W3-α. Changed: §5.3 G-14/G-15, Appendix A §9/§11, Appendix B.
10. **Applied, with a note.**
    - IMPLEMENTATION-PLAN:606 does give "registration of the H-07 close job" to H-05. The option chosen: H-07's human PR carries the one `cron.ts` line, and H-05's scope drops it (Appendix A §13, approval 13).
    - Detail: W3-γ deploys on Tue 5.1.2027, the 5th itself. So the job must catch up any closed month that has no snapshot on its first run. Otherwise December is still missed.
11. **Applied.** The IMPLEMENTATION-PLAN §6 column is "Gate to start" (line 633). Approval 11 now names every pre-gate start. W2-08 starts Tue 10.11 and aims for γ (after W2-03), which pulls the gate to 26.11, with δ 3.12 as the fallback (risk 16).
12. **Applied.** W2-16.md:29 (on `claude/ux-w2-16-copy-focus-docs`) gives W2-16b `messages/{auth,onboarding,admin,recipes,catalog,products,chain,vat}/**`, the copy lines of `dashboard/{recipes,catalog,products,chain,branches,reports}/**` and the prose in `routers/{onboarding,admin,products}.ts`. Each successor (W3-02a, W3-07a-1, W3-10, W3-01 matrix, W3-07b, W3-08a) now starts only after its area's rows are GREEN. W2-16b lands its rows in that order. Changed: §2 P2, §3, §5.2, §5.3, Appendix B.
13. **Applied.** AU README §9: AU-01 owns `FeaturesPanel.tsx` and `api/lib/features.ts` (`OWNER_TOGGLEABLE`); AU-07 adds `admin.automationKpis` to `routers/admin.ts`. IMPLEMENTATION-PLAN:562 has W3-07a's "פיצ׳רים פעילים" view. AU-01 and AU-07 now run first, and W3-07a-1 starts after both are GREEN, with the carve-out as a fallback.
14. **Applied, with a note.**
    - #235 @ `ca8f3993` has only `docs/ux/automation/**` (none under `docs/ux/wave3/`), so the "move AU" step is removed. The README still reads "At most 8 AU sessions at a time" and Phase A "6 at once". The research session amends it before any AU start.
    - Lanes: AU-11 becomes a W3-09 addendum (README §9 allows this). AU-04 takes the first AU slot on 30.11, and H-05/W3-03b wait for it to be integrated. AU-10 gets a W-h slot before W3-11. AU-09 and AU-12 go to W-i, after G-15 and W3-03 merge. AU-15 runs after W3-10 merges.
    - Detail: **AU-13 is path-disjoint from W3-10** (`priceAlerts.ts`, `api/priceAlerts/**`; it only reads `recipes/alerts.ts`), so it gets a real W-h slot beside W3-10 instead of waiting.
    - The caps now hold: ≤2 until 3.12, ≤3 in December (§6.4 check).
15. **Partly wrong.**
    - W2-15.md:55 already says KpiCard/StatCard "keep their props and render MetricTile … **no consumer file changes**". W2-15.md:8 says the showcase pages hold local copies that are "lint targets, not consumers". So W2-15 final writes none of the 5 named folders, and there is no path collision.
    - Applied only the part that holds: W2-15 final edits no consumer or showcase file and keeps lint at warn, and the W3 slices refresh their own screenshot baselines after ε.
16. **Applied** (option 1).
    - Kit README §5: "Self-repair cap: 2". The plan now has a GREEN-pending-#180 status, one push before the rebase, and completeness-only red exempt from the cap (§3, §5.1, Appendix A §5/§6).
    - Option 2 was rejected: #180 restructures the manifest, so new base entries would conflict with it.
    - After 3, this affects only W2-12 (and W2-03/W2-08 if they start on `main@B`).
17. **Applied.**
    - `docs/ops/PROMOTE-ROLLBACK.he.md:7` confirms that every build, `main` included, waits for a manual Promote.
    - α now merges Mon 16.11 ~18:00, just before the Tue 17.11 deploy, so `main` = production through pilot week 1. The hot-fix path is defined for later trains (§4.1).
    - Approvals 2, 3 and 4 moved to Thu 12.11 morning. Mon 9.11 is impossible for #180, which is only rebased on Tue.
18. **Applied.** §5.2 G-12 did say "after #196", while δ listed #195 first. With the moves in 8 and 11, δ = #195 + the four sweep PRs. The fallback order is W2-08 → #191 → #196 → #195 (§4.2).
19. **Applied, with a note** (option A). H-04 is drafted from IMPLEMENTATION-PLAN:605 without the PIN/device/sessions rows, with addendum commits as the field lists land. Detail: W3-02's brief is due Sun 15.11 (§6.1), so only W3-07b's (27.11) and W3-08's (4.12) lists come late. The conclusion holds.
20. **Applied.**
    - ci.yml:108-109 (`doctor --strict`) and 113-114 (`supabase-sync --check`) are within the cited 95-118.
    - `rls.ts:201` revokes INSERT/UPDATE/DELETE on `users` from the app role.
    - Also added: STATE.md:100. New tenant tables must join the `rls/0002` list, or `check-rls` fails.
    - Changed: §5.1 G-03/H-03 and W2-14, §6.1.
21. **Applied.** W2-08.md:47 lets W2-08 add a `badge` key to `routes/{ask,branches,catalog,chain,products,recipes,reports}.ts`. W2-08's first commit now adds all seven, and wave-3 packages edit them only on a base that has W2-08's merge (§3, §5.1, Appendix B).
22. **Applied.** Under AGENTS.md, matching-engine-guardian owns charts SQL and web-feature-engineer "never edits it". IMPLEMENTATION-PLAN:524 (W3-01 `chain.ts`) and :584 (W3-09's new `coverage.ts`) give those files to wave-3 packages. Both are now co-owned slices, human-PR if ₪ math changes; AU-07's `automation.ts` already names its co-owner. W3-07b's `/join/[token]` (IMPLEMENTATION-PLAN:569) is added to risk 14, with a warden review and its brief excluding `rateLimit.ts` and `route.ts`.
23. **Applied.** Each item now has a slot or owner:
    - W2-05 B2 runs in the W2-05 session after slice C and merges in γ or δ;
    - W3-06b runs in W-h and merges in W3-γ;
    - W3-α's independent slices are named (W3-04a, W3-02a, W3-05a, W3-07a-1, W3-06a);
    - the claims rule is owned by W2-03 with W2-10, settled by Tue 24.11 and signed by leak-economist + matching-engine-guardian;
    - Batch P is confirmed before Mon 9.11 18:00 (§10).
24. **Applied.** AU README §9 gives AU-01 `packages/db/scripts/pilot-config.ts`. The lock now covers `schema.ts`, `drizzle/**`, `rls.ts` and `supabase/**`; `plans.ts` and `pilot-config.ts` sit outside it, and H-10 adds no migration. H-10 merges in W3-α if decided by ~10.12 (the (h) move).
25. **Applied, with a note.**
    - Kit §7 already says "there is no PIN" and "The old mobile app is FROZEN". But device mode (approval 7) and H-11's confirmation of 6 and 12 (map_w4 §D item 3) were open.
    - Appendix A §7 now lists 6 and 13 as "pending owner", and 12 moves to decided (kit §7).
    - The H-11 confirmation is approval 12.

**Found while verifying (not in the review list):**
- **A1: a schema merge is a deploy.** `docs/SUPABASE-GITHUB-DEPLOY.md:109` says "Merging into `main` deploys new migrations to the production database immediately", and the ci.yml comment at 111-112 matches. The old plan merged G-03/H-03 inside β on Thu 19.11 but "deployed" them on Tue 24.11, which can't happen. Fixed:
  - G-03 and H-03 (and later H-04 and H-13) are their own PRs, merged on a deploy Tuesday at 09:00, after the backup and the 2nd gate;
  - they never ride a Thursday train (§0, §4.1, §4.2, risk 15). The 24.11 date that corrections 6 and 7 assume is kept.
- **A2:** after 3, W-d would have run 9 sessions. W2-14 moved to Sat 14.11 (see 3).
- **A3:** the G-04 addendum also has a brief addendum that exists only on the kit branch (see 2).
- **A4:** moving α to Mon 16.11 means sessions that needed "main@α" before then (G-15, W2-11, W2-14) base on the frozen `rw2-α` tag, which has the same content.
