#!/usr/bin/env node
/*
 * check-partition.cjs: the mechanical check of the invoices batch's partition.
 *
 *   node docs/ux/inv/check-partition.cjs <path of a checkout> [--strict] [--self-test] [--manifest <file>]
 *   node docs/ux/inv/check-partition.cjs <path of a checkout> --changed <package id> [--stdin]
 *
 * It reads packages.json beside this script, lists the tracked files of the checkout with
 * `git ls-files`, expands every glob against that list, and exits with code 1 (printing each problem) when:
 *
 *   1. a file is owned by two packages;
 *   2. an owned glob matches no tracked file and is not repeated under the package's newFiles;
 *   3. an owned file, a new path or a seam file is on the immutable list;
 *   4. an owned file or a new path is on the list of files given to nobody;
 *   5. a path one package will create falls inside another package's boundary;
 *   6. a seam is wrong: its "who" is not the package that lists it, its file is inside the boundary of the
 *      package that edits it, its named owner does not own the file, or it says "shared" for a file a
 *      package owns;
 *   7. the manifest itself is broken (a missing field, a repeated id or branch, an unknown dependency,
 *      a newFiles entry that is not in owns, a file a package both owns and carves out);
 *   8. a pull request base is not the first branch the package merges in (or startFrom when it merges
 *      nothing), a package it depends on is not merged in, or it depends on a later wave;
 *   9. two owned paths differ only by letter case (they collide on a case-insensitive disk).
 *
 * --changed <package id> checks a session's own changes instead of the plan: it lists the files of the
 * commits that are on HEAD and on none of origin/<startFrom> and origin/<each mergeIn branch> (merge commits
 * left out), and exits 1 when one of them is neither the package's own file nor one of its seam files, or
 * is on the immutable list. A seam file is printed as "seam". With --stdin the list of paths is read from
 * standard input instead (one path per line). A conflict resolved inside a merge commit is not listed.
 *
 * It only reads: `git ls-files` (and, with --changed, `git rev-parse` and `git log`) in the checkout,
 * nothing written anywhere. No dependencies.
 *
 * A file is a package's when it matches one of the package's "owns" globs and none of its "reserved" globs.
 * Glob syntax: `**` any depth, `*` inside one path segment, `?` one character. Nothing else is special:
 * `[invoiceId]` and `(register)` are literal, as they are on disk.
 *
 * A warning changes the exit code only with --strict: a path listed as new that already exists in this
 * checkout (read it: either the package has landed, or the name is taken by somebody else, which matters
 * for packages/api/src/__tests__/coverage/IA-04.ts), and a seam file that is in no checkout and that no
 * package creates. A note is information only: a seam file that does not exist yet, and an entry of the
 * reserved, nobody or immutable lists that matches no tracked file here (a typo there would be silent).
 *
 * --self-test plants twelve faults in a copy of the manifest, one at a time, and reports whether the check
 * catches each. It exits 1 if a planted fault goes unnoticed.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ── arguments ────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const manifestAt = args.indexOf('--manifest');
const manifestPath = manifestAt >= 0 ? args[manifestAt + 1] : path.join(__dirname, 'packages.json');
const changedAt = args.indexOf('--changed');
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(manifestAt >= 0 && i === manifestAt + 1) && !(changedAt >= 0 && i === changedAt + 1),
);
const checkout = positional[0];
if (!checkout) {
  console.error('usage: node check-partition.cjs <path of a checkout> [--strict] [--self-test] [--manifest <file>]');
  console.error('       node check-partition.cjs <path of a checkout> --changed <package id> [--stdin]');
  process.exit(2);
}
const strict = flags.has('--strict');

// ── globs ────────────────────────────────────────────────────────────────────────────────────────
const cache = new Map();
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; ) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const atSegmentStart = i === 0 || glob[i - 1] === '/';
      if (atSegmentStart && glob[i + 2] === '/') {
        re += '(?:.*/)?'; // "**/" is zero or more folders
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += c.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(re + '$');
}
function matches(glob, file) {
  let re = cache.get(glob);
  if (!re) cache.set(glob, (re = globToRegExp(glob)));
  return re.test(file);
}
const matchesAny = (globs, file) => (globs || []).some((g) => matches(g, file));
const isGlob = (s) => /[*?]/.test(s);
/** A path that a glob of new files would hold, for the checks on files that do not exist yet. */
const probeOf = (glob) => glob.replace(/\*\*/g, 'new-folder/new-file').replace(/\*/g, 'new').replace(/\?/g, 'n');

// ── the checkout ─────────────────────────────────────────────────────────────────────────────────
function trackedFiles(dir) {
  const out = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}
function headOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short=8', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch {
    return 'unknown';
  }
}

// ── the check ────────────────────────────────────────────────────────────────────────────────────
function check(manifest, files) {
  const problems = [];
  const warnings = [];
  const notes = [];
  const fail = (kind, text) => problems.push({ kind, text });
  const packages = Array.isArray(manifest.packages) ? manifest.packages : [];
  const immutable = manifest.immutable || [];
  const nobody = manifest.nobody || [];
  const ids = new Set();
  const branches = new Set();

  // 7. the manifest itself
  if (!manifest.generatedFrom) fail('manifest', 'generatedFrom is missing');
  if (packages.length === 0) fail('manifest', 'no packages');
  if (immutable.length === 0) fail('manifest', 'the immutable list is empty');
  for (const p of packages) {
    for (const key of ['id', 'title', 'wave', 'base', 'branch', 'owns', 'newFiles', 'seams', 'reserved', 'dependsOn']) {
      if (p[key] === undefined) fail('manifest', `${p.id || '(no id)'}: the field "${key}" is missing`);
    }
    if (ids.has(p.id)) fail('manifest', `the id ${p.id} is used twice`);
    ids.add(p.id);
    if (branches.has(p.branch)) fail('manifest', `the branch ${p.branch} is used twice`);
    branches.add(p.branch);
    for (const n of p.newFiles || []) {
      if (!(p.owns || []).includes(n)) fail('manifest', `${p.id}: newFiles entry "${n}" is not in owns`);
    }
  }
  for (const p of packages) {
    for (const d of p.dependsOn || []) {
      if (!ids.has(d)) fail('manifest', `${p.id}: depends on ${d}, which is not a package of this file`);
    }
  }

  // 8. bases: the base is the first branch merged in; every package it depends on is merged in.
  for (const p of packages) {
    for (const key of ['startFrom', 'mergeIn']) {
      if (p[key] === undefined) fail('manifest', `${p.id}: the field "${key}" is missing`);
    }
    const mergeIn = p.mergeIn || [];
    const first = mergeIn[0] || p.startFrom;
    if (p.base !== first) fail('base', `${p.id}: the base is ${p.base}, and the first branch it merges in is ${first}`);
    for (const d of p.dependsOn || []) {
      const dep = packages.find((q) => q.id === d);
      if (dep && !mergeIn.includes(dep.branch)) fail('base', `${p.id}: depends on ${d} and does not merge ${dep.branch}`);
      if (dep && dep.wave > p.wave) fail('base', `${p.id} (wave ${p.wave}) depends on ${d} (wave ${dep.wave})`);
    }
  }

  // An entry of reserved / nobody / immutable that matches no tracked file: a typo there is silent otherwise.
  const dead = (label, g) => {
    if (!files.some((f) => matches(g, f))) notes.push(`${label}: "${g}" matches no tracked file here`);
  };
  for (const g of immutable) dead('immutable', g);
  for (const g of nobody) dead('nobody', g);
  for (const p of packages) for (const g of p.reserved || []) dead(`${p.id} reserved`, g);

  // 9. two owned paths that differ only by letter case collide on a case-insensitive disk.
  const lower = new Map();
  for (const p of packages) {
    for (const g of p.owns || []) {
      const k = g.toLowerCase();
      const seen = lower.get(k);
      if (seen && seen.g !== g) fail('owned twice', `"${g}" (${p.id}) and "${seen.g}" (${seen.id}) differ only by case`);
      else if (!seen) lower.set(k, { g, id: p.id });
    }
  }

  const ownsPath = (p, file) => matchesAny(p.owns, file) && !matchesAny(p.reserved, file);
  const owned = new Map(); // package id → its tracked files
  for (const p of packages) owned.set(p.id, files.filter((f) => ownsPath(p, f)));

  // 2. a dead glob
  for (const p of packages) {
    for (const g of p.owns || []) {
      const hits = files.filter((f) => matches(g, f));
      const declaredNew = (p.newFiles || []).includes(g);
      if (hits.length === 0 && !declaredNew) {
        fail('dead glob', `${p.id}: "${g}" matches no tracked file and is not under newFiles`);
      }
      if (hits.length > 0 && declaredNew) {
        warnings.push(`${p.id}: "${g}" is listed as new and already exists here (${hits.length} file${hits.length === 1 ? '' : 's'}, first: ${hits[0]})`);
      }
      if (hits.length > 0 && hits.every((f) => matchesAny(p.reserved, f))) {
        fail('manifest', `${p.id}: "${g}" is in owns, and its own reserved list carves all of it out`);
      }
    }
  }

  // 1. owned twice
  const firstOwner = new Map();
  let pairs = 0;
  for (let i = 0; i < packages.length; i += 1) for (let j = i + 1; j < packages.length; j += 1) pairs += 1;
  for (const p of packages) {
    for (const f of owned.get(p.id)) {
      const other = firstOwner.get(f);
      if (other) fail('owned twice', `${f}: ${other} and ${p.id}`);
      else firstOwner.set(f, p.id);
    }
  }

  // 3 and 4. immutable, and given to nobody
  for (const p of packages) {
    for (const f of owned.get(p.id)) {
      if (matchesAny(immutable, f)) fail('immutable', `${p.id} owns ${f}, which is on the immutable list`);
      if (matchesAny(nobody, f)) fail('nobody', `${p.id} owns ${f}, which this batch gives to nobody`);
    }
  }

  // 5. paths that do not exist yet
  for (const p of packages) {
    for (const g of p.newFiles || []) {
      const probe = isGlob(g) ? probeOf(g) : g;
      if (!ownsPath(p, probe)) fail('manifest', `${p.id}: the new path "${g}" is carved out by its own reserved list`);
      if (matchesAny(immutable, probe)) fail('immutable', `${p.id}: the new path "${g}" is on the immutable list`);
      if (matchesAny(nobody, probe)) fail('nobody', `${p.id}: the new path "${g}" is given to nobody`);
      for (const q of packages) {
        if (q.id !== p.id && ownsPath(q, probe)) fail('owned twice', `the new path "${g}": ${p.id} and ${q.id}`);
      }
    }
  }

  // 6. seams
  let seamCount = 0;
  for (const p of packages) {
    for (const s of p.seams || []) {
      seamCount += 1;
      const label = `${p.id} seam ${s.file}`;
      if (!s.file || !s.owner || !s.who || !s.what) {
        fail('seam', `${label}: file, owner, who and what are all required`);
        continue;
      }
      if (s.who !== p.id) fail('seam', `${label}: "who" is ${s.who}, and the seam is listed under ${p.id}`);
      const targets = isGlob(s.file) ? files.filter((f) => matches(s.file, f)) : [s.file];
      if (targets.length === 0) targets.push(probeOf(s.file));
      for (const f of targets) {
        if (matchesAny(p.reserved, f)) fail('seam', `${label}: ${f} is on ${p.id}'s own reserved list`);
        if (matchesAny(immutable, f)) fail('immutable', `${label}: ${f} is on the immutable list`);
        if (ownsPath(p, f)) fail('seam', `${label}: ${f} is inside ${p.id}'s own boundary, so it is not a seam`);
        const holders = packages.filter((q) => ownsPath(q, f)).map((q) => q.id);
        if (ids.has(s.owner)) {
          if (s.owner === p.id) fail('seam', `${label}: the owner and the editor are the same package`);
          if (!holders.includes(s.owner)) fail('seam', `${label}: ${s.owner} is named as the owner and does not own ${f}`);
        } else if (holders.length > 0) {
          fail('seam', `${label}: the owner is given as "${s.owner}", and ${holders.join(', ')} owns ${f}`);
        }
        if (!files.includes(f) && !isGlob(s.file)) {
          const ownerPkg = packages.find((q) => q.id === s.owner);
          if (ownerPkg && ownsPath(ownerPkg, f)) notes.push(`${label}: not in this checkout yet (a new file of ${s.owner}'s boundary; the seam's text says who creates it)`);
          else warnings.push(`${label}: not in this checkout, and no package creates it`);
        }
      }
    }
  }

  const summary = packages.map((p) => ({
    id: p.id,
    wave: p.wave,
    base: p.base,
    tracked: owned.get(p.id).length,
    newPaths: (p.newFiles || []).length,
    seams: (p.seams || []).length,
  }));
  return { problems, warnings, notes, summary, pairs, seamCount };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = trackedFiles(checkout);
const immutableSeen = files.filter((f) => matchesAny(manifest.immutable, f)).length;

if (flags.has('--self-test')) {
  const clone = () => JSON.parse(JSON.stringify(manifest));
  const byId = (m, id) => m.packages.find((p) => p.id === id);
  const first = manifest.packages[0];
  const second = manifest.packages[1];
  const plants = [
    ['a file owned twice', 'owned twice', (m) => byId(m, second.id).owns.push(first.owns[0])],
    ['a glob that matches nothing', 'dead glob', (m) => byId(m, first.id).owns.push('apps/web/no-such-folder/**')],
    ['an immutable file in a boundary', 'immutable', (m) => byId(m, first.id).owns.push('AGENTS.md')],
    ['a file given to nobody in a boundary', 'nobody', (m) => {
      const p = byId(m, first.id);
      const f = files.find((x) => matchesAny(m.nobody, x) && !matchesAny(m.immutable, x) && !matchesAny(p.reserved, x));
      p.owns.push(f);
    }],
    ['a file both owned and carved out by the same package', 'manifest', (m) => {
      const p = byId(m, first.id);
      p.reserved.push(p.owns[0]);
    }],
    ['a new path inside another boundary', 'owned twice', (m) => {
      const p = byId(m, first.id);
      const g = second.owns.find((o) => o.endsWith('/**'));
      const inside = g.replace('/**', '/planted-new-file.ts');
      p.owns.push(inside);
      p.newFiles.push(inside);
    }],
    ['a seam on an immutable file', 'immutable', (m) => byId(m, first.id).seams.push({ file: 'AGENTS.md', owner: 'shared', who: first.id, what: 'planted' })],
    ['a seam whose named owner does not own the file', 'seam', (m) => byId(m, first.id).seams.push({ file: 'README.md', owner: second.id, who: first.id, what: 'planted' })],
    ['a seam on a file of the package\'s own reserved list', 'seam', (m) => {
      const p = byId(m, first.id);
      p.seams.push({ file: p.reserved[0], owner: 'shared', who: first.id, what: 'planted' });
    }],
    ['a base that is not the first branch merged in', 'base', (m) => {
      byId(m, second.id).base = 'planted-branch';
    }],
    ['a dependency that is not merged in', 'base', (m) => {
      const p = m.packages.find((q) => (q.dependsOn || []).length > 0);
      p.mergeIn = p.mergeIn.filter((b) => b !== byId(m, p.dependsOn[0]).branch);
    }],
    ['two owned paths that differ only by case', 'owned twice', (m) => {
      const p = byId(m, first.id);
      const g = second.owns[0];
      const other = g === g.toUpperCase() ? g.toLowerCase() : g.toUpperCase();
      p.owns.push(other);
      p.newFiles.push(other);
    }],
  ];
  let missed = 0;
  console.log(`self-test against ${checkout} (${headOf(checkout)}), ${plants.length} planted faults`);
  for (const [name, kind, plant] of plants) {
    const m = clone();
    plant(m);
    const caught = check(m, files).problems.some((p) => p.kind === kind);
    if (!caught) missed += 1;
    console.log(`  ${caught ? 'caught' : 'MISSED'}  ${name}`);
  }
  console.log(missed === 0 ? 'SELF-TEST: PASS' : `SELF-TEST: FAIL (${missed} planted fault${missed === 1 ? '' : 's'} not caught)`);
  process.exit(missed === 0 ? 0 : 1);
}

// --changed <package id>: the files of the session's own commits, against the package's boundary and seams.
if (changedAt >= 0) {
  const p = manifest.packages.find((q) => q.id === args[changedAt + 1]);
  if (!p) {
    console.error(`--changed needs a package id of ${manifestPath}`);
    process.exit(2);
  }
  let changed;
  let from;
  if (flags.has('--stdin')) {
    changed = fs.readFileSync(0, 'utf8').split('\n');
    from = 'standard input';
  } else {
    const upstream = [p.startFrom, ...(p.mergeIn || [])].map((b) => `origin/${b}`);
    for (const ref of upstream) {
      try {
        execFileSync('git', ['-C', checkout, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' });
      } catch {
        console.error(`--changed: ${ref} is not in this checkout. Fetch it (git fetch origin ${ref.slice('origin/'.length)}) or pass the paths with --stdin.`);
        process.exit(2);
      }
    }
    const out = execFileSync(
      'git',
      ['-C', checkout, '-c', 'core.quotePath=false', 'log', '--no-merges', '--name-only', '--format=', 'HEAD', '--not', ...upstream],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    changed = out.toString('utf8').split('\n');
    from = `the commits on HEAD (${headOf(checkout)}) that are on none of ${upstream.join(', ')}`;
  }
  changed = [...new Set(changed.map((x) => x.trim()).filter(Boolean))].sort();
  const mine = (f) => matchesAny(p.owns, f) && !matchesAny(p.reserved, f);
  const seam = (f) => (p.seams || []).some((x) => matches(x.file, f));
  let bad = 0;
  console.log(`${p.id}: ${changed.length} changed file${changed.length === 1 ? '' : 's'}, from ${from}`);
  for (const f of changed) {
    const why = matchesAny(manifest.immutable, f) ? 'on the immutable list' : mine(f) || seam(f) ? null : 'outside the boundary and not a seam';
    if (why) {
      bad += 1;
      console.log(`  FAIL [changed] ${f}: ${why}`);
    } else if (!mine(f)) {
      console.log(`  seam: ${f}`);
    }
  }
  console.log(
    bad === 0
      ? `RESULT: PASS (every changed file is inside ${p.id}'s boundary or is one of its seams; a seam is still only the edit its text names)`
      : `RESULT: FAIL (${bad} of ${changed.length} changed files)`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

const result = check(manifest, files);
console.log(`partition of ${manifest.generatedFrom}, checked against ${checkout} (HEAD ${headOf(checkout)}, ${files.length} tracked files)`);
for (const s of result.summary) {
  console.log(
    `  ${s.id}  wave ${s.wave}  owns ${String(s.tracked).padStart(3)} tracked file${s.tracked === 1 ? ' ' : 's'}, ${String(s.newPaths).padStart(2)} new path${s.newPaths === 1 ? ' ' : 's'}, ${s.seams} seam${s.seams === 1 ? '' : 's'}  →  ${s.base}`,
  );
}
console.log(`  ${result.pairs} package pairs compared; ${result.seamCount} seams checked; ${immutableSeen} immutable files in this checkout`);
for (const n of result.notes) console.log(`  note: ${n}`);
for (const w of result.warnings) console.log(`  warning: ${w}`);
if (result.problems.length === 0 && !(strict && result.warnings.length > 0)) {
  console.log('RESULT: PASS (no file in two packages, no dead glob, nothing immutable or reserved in a boundary, every seam has one owner, every base is the first branch merged in)');
  process.exit(0);
}
for (const p of result.problems) console.log(`  FAIL [${p.kind}] ${p.text}`);
if (strict && result.warnings.length > 0) console.log(`  FAIL [strict] ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} above count as failures with --strict`);
const failures = result.problems.length + (strict ? result.warnings.length : 0);
console.log(`RESULT: FAIL (${failures} problem${failures === 1 ? '' : 's'})`);
process.exit(1);
