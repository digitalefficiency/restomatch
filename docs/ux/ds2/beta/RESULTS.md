# DS2 β · font swap · gate results (lab, 7.11.2026)

Lab `W2-15` (demo tenant, DEMO_TODAY 2026-10-25 under faketime), production build, Chromium 153.
Heebo = the same branch with `ACTIVE_FACE = 'heebo'` (the undo path), so both runs share every other byte.
Probes: `probes/*.cjs` (run from `apps/web` after `bash docs/ux/wave2/lab.sh W2-15`, copied to `~/.rm-lab/w2_15/`).

| Gate (VERDICT §9) | Target | Plex (β) | Heebo (today) | Result |
|---|---|---|---|---|
| Preloaded font bytes (he) | ≤ 50 KB | **48.8 KiB** (400 + 700 × hebrew + latin) | 41.2 KiB | pass |
| First-load font bytes, owner home | ≤ 100 KB | **99.8 KiB** he · 95.0 KiB en (4 weights) | 95 KiB | pass (tight) |
| Plex Mono / Frank Ruhl on app routes | 0 KB | 0 · 0 | — | pass |
| Every ₪ painted in Plex | 0 system fallback | **0** of 2,532 ₪ nodes (10 routes × he/en × 1440/1280/390) | Heebo + JetBrains Mono + DejaVu Sans Mono (₪ inside `font-mono`) | pass; fixes the foreign ₪ |
| No ₪ truncated at 1440 / 1280 / 390 | 0 | **0** (60 runs) | 0 | pass |
| CLS, gate routes (home, approvals, pay run, receiving) | ≤ 0.01 | ≤ 0.0081 (3 runs × he/en × 1440/390) | ≤ 0.0037 | pass* |
| LCP owner home, Pixel 7, 4× CPU, 1.6 Mbps / 150 ms | ≤ baseline + 100 ms | **1012 ms** median of 7 | 1152 ms | pass (−140 ms) |
| Decimals aligned within 0.5 px | ≤ 0.5 px | ledger 28–33 px, recovery col 4 109 px | ledger 35–36 px, recovery 104 px | **not font**: same on Heebo; column alignment (N5 / MoneyCell, phase 3) |
| Demo ₪ invariants | unchanged | ₪760 / 296 / 464 / 1,123 / 1,267 | same | pass (`vr2-*.jpg`) |

\* Two exceptions, both explained:
- `/dashboard` at 1440 shows a 0.12–0.135 shift on the first cold run in both faces (the Heebo baseline too): not the font.
- `/dashboard/leaks` en 1440: 0.026 (Heebo 0). The lab-only "processing engine unavailable" banner (no worker in the lab) sets its heading at 600, which is not preloaded; it paints in the fallback and swaps. Weight-matched fallbacks (Arial Bold for 550+) cut it from 0.052 to 0.026. With the worker running the banner is absent.

## What changed to get there
1. A second `--font-heebo: 'Heebo'` in the S9 block overrode the swap: it now reads `var(--font-ui-faces)` (faces only, no generic family, so the Noto receiver fonts that follow stay reachable).
2. Fontsource's latin-ext range lists U+20AA, so every ₪ fetched a latin-ext file: ₪ is cut from that range (the hebrew file draws it).
3. The Plex files are re-encoded with fontTools keeping every glyph, glyph name, advance, layout feature and the TrueType hinting; only the long name records (licence text, URLs) are dropped. 102,620 → 102,168 bytes for the 4 app weights. The OFL text ships beside the files; Plex declares no Reserved Font Name.
4. Fallbacks are measured per weight band (G13) on the shipped files.

## Known, out of β scope
- ▲/▼ and → (U+25BC, U+2192) are not in Plex (nor in Heebo): one glyph on the home page falls back to the system font. G11: draw them as icons (`DeltaCell`, phase 3).
- `font-mono` now paints Plex for identifiers (D3) and for the money it still wraps; removing `font-mono` around money is money-format-marshal's (proposal).
- The tokens-lab visual baselines (`W1-01`, 3 PNGs) change with the face: re-record after #214 lands, once the owner signs these diffs.
