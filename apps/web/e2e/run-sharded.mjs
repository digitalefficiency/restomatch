#!/usr/bin/env node
/**
 * F-7: the full e2e suite as N sequential Playwright shards, each with its OWN
 * fresh `next dev` (the webServer lifecycle starts and stops one per invocation).
 *
 * Why: next dev restarts itself when its V8 heap passes 0.8 × heap_size_limit
 * (next/dist/server/lib/start-server.js). The limit is 50% of RAM, and RSS runs
 * at ~1.85 × the heap (turbopack native memory), so a bigger heap means an
 * OOM-kill, not a fix. A single 600+ test run crossed the threshold twice per CI
 * run (~every 22 min), killing whatever navigation was in flight (the "F-7"
 * flakes: W2-04:304, W1-04:325, W1-03, W3-01 …). A shard ends long before that.
 *
 * Measured locally (15 GB, 21.11): one run → 1 restart at +32 min, 514 passed /
 * 90 failed; 4 shards → 0 restarts, 592 passed / 33 failed (no new failure), peak
 * heap 55/55/69/73% of the limit (trigger 80%). Default 6 keeps that margin in CI,
 * which grows faster (~22 min to the trigger on one server).
 *
 * Same DB state and order as one run: shard 1 seeds (playwright.config.ts →
 * e2e/prepare-db.ts); shards 2…N run with E2E_SKIP_SEED=1 on the same DB.
 * Playwright gives contiguous file chunks in the usual order with
 * fullyParallel=false / workers=1 (checked with --list).
 *
 * Filtered runs (a spec path, -g/--grep, --list, --shard, --ui …) are passed
 * straight through as ONE invocation. E2E_SHARDS=1 disables sharding.
 *
 * Output: every shard's own output, a loud
 *   [e2e-sharded] dev server memory restart at <test>
 * whenever next dev restarts anyway, and one combined line
 *   [e2e-sharded] N passed, N failed, N flaky, N skipped (…)
 * Exit code: non-zero if any shard failed.
 */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const args = process.argv.slice(2);
const PASS_THROUGH = /^(-g|--grep|--grep-invert|--list|--shard|--ui|--debug|--last-failed|--only-changed)(=|$)/;
const filtered = args.some((a) => !a.startsWith('-') || PASS_THROUGH.test(a));
const shards = filtered ? 1 : Math.max(1, Number(process.env.E2E_SHARDS ?? 6));

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const RESTART = /approaching the used memory threshold/;
// The list reporter's progress line: "  ✓  12 [chromium] › e2e/x.spec.ts:3:1 › title (1.2s)" or "[12/170] [chromium] › …".
const TEST_LINE = /\[(?:chromium|setup)\] › (.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/;
const SUMMARY = /^\s+(\d+) (passed|failed|flaky|skipped|interrupted|did not run)\b/;

const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0, interrupted: 0, 'did not run': 0 };
const restarts = [];
let failedShards = 0;

function portBusy() {
  return new Promise((resolve) => {
    const s = createConnection({ port: PORT, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
}

async function waitPortFree(ms = 60_000) {
  const until = Date.now() + ms;
  while (await portBusy()) {
    if (Date.now() > until) throw new Error(`[e2e-sharded] port ${PORT} is still in use after ${ms / 1000}s (a dev server outlived its shard)`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function runShard(k) {
  return new Promise((resolve) => {
    const shardArgs = shards > 1 ? [`--shard=${k}/${shards}`] : [];
    const env = { ...process.env };
    // Shard 1 seeds; later shards keep the state the earlier ones left (one run's state).
    if (k > 1) env.E2E_SKIP_SEED = '1';
    // Each invocation prepares the DB itself and must start its own server.
    delete env.E2E_APP_URL;
    if (shards > 1) console.log(`\n[e2e-sharded] ── shard ${k}/${shards} ──`);
    const child = spawn('pnpm', ['exec', 'playwright', 'test', ...shardArgs, ...args], {
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    let current = '(before the first test)';
    let buf = '';
    const onData = (stream) => (chunk) => {
      stream.write(chunk);
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(ANSI, '');
        buf = buf.slice(nl + 1);
        const t = TEST_LINE.exec(line);
        if (t && !line.includes('[WebServer]')) current = t[1];
        if (RESTART.test(line)) {
          restarts.push(`shard ${k}: ${current}`);
          console.log(`::error::[e2e-sharded] dev server memory restart at ${current} (shard ${k}/${shards})`);
        }
        const s = SUMMARY.exec(line);
        if (s) totals[s[2]] += Number(s[1]);
      }
    };
    child.stdout.on('data', onData(process.stdout));
    child.stderr.on('data', onData(process.stderr));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const started = Date.now();
for (let k = 1; k <= shards; k += 1) {
  await waitPortFree();
  const code = await runShard(k);
  if (code !== 0) failedShards += 1;
}
await waitPortFree().catch((e) => console.error(e.message));

const mins = ((Date.now() - started) / 60_000).toFixed(1);
console.log(
  `\n[e2e-sharded] ${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped` +
    (totals.interrupted ? `, ${totals.interrupted} interrupted` : '') +
    ` (${shards} shard${shards === 1 ? '' : 's'}, ${restarts.length} dev-server restart${restarts.length === 1 ? '' : 's'}, ${mins}m)`,
);
for (const r of restarts) console.log(`[e2e-sharded]   restart: ${r}`);
process.exit(failedShards > 0 ? 1 : 0);
