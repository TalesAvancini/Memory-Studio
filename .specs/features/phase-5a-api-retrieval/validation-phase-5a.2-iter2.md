---
date: 2026-07-31
version: 1
description: "Independent verifier report for Phase 5a.2 retrieval pipeline (iter 2) — tiebreak fix, smoke boot, idempotent script."
explanation: |
  Re-runs project gates, exercises the FT-01/02/03 fix tasks against the
  iter-1 FAIL list, performs an independent K=5 × 1000 random-RRF-score
  stress sensor for D-006, and re-validates R-09..R-14. Verdict is FAIL
  because FT-02 (server boot smoke) is broken: the smoke script reaches
  the `[PASS]` lines but never exits (the killChild cleanup loops
  forever waiting for child exit on Windows), so the wrapper tests at
  test/server/smoke-boot.test.mjs both timeout at 30s and `npm test`
  exits non-zero (271/273 pass, 2 fail). FT-01 (D-006 tiebreak) is
  confirmed PASS by both an embedded test and an independent stress
  sensor. FT-03 (idempotent script) depends on FT-02 and therefore
  cannot be green on this host.
---

# Validation — Phase 5a.2 Retrieval Pipeline (iter 2)

## Verdict

**FAIL**. The iter 1 CRITICAL (G1 R-11 tiebreak D-006) is genuinely
fixed — `topKAndTiebreak()` now sorts slug ASC as PRIMARY with `rrfScore`
DESC only as a secondary on collision. The K=5 × 1000 random-RRF stress
sensor reports 1 unique SHA-256, 0 drift, baseline `c038eb79fcb9...`.
However FT-02 (server boot smoke) is broken on this Windows host: the
script reaches the `[PASS]` lines but hangs at `killChild()` cleanup,
so both wrapper tests in `test/server/smoke-boot.test.mjs` (`smoke-boot:
script exits 0`, `smoke-boot: no orphan server`) timeout at 30s. This
breaks the project's standard gate (`npm test`) and cascades into FT-03
(idempotent: `npm test && npm test`). 271/273 root tests pass — exactly
the 2 smoke-wrapper tests fail. Score-INDEPENDENT determinism (the
critical fix) is real, but the smoke infrastructure did not survive a
cross-OS reality check.

## Gate evidence

- Root `npm test`: **FAIL** — exit 1; 273 tests, 271 pass, 2 fail.
  Failures are test #191 `smoke-boot: scripts/smoke-server-boot.mjs
  exits 0 with [PASS] lines` (timeout 30000ms) and #192
  `smoke-boot: leaves no orphan server after cleanup (smoke script
  self-kills)` (second run got code -1, stdout captured from leaked
  child shows `[PASS]` from the first leak). Total wall time ~86s
  (the two smoke timeouts add ~60s).
- Root `npm run typecheck`: **PASS** — exit 0; `tsc --noEmit` clean.
- Root `npm run verify-env`: **PASS** — exit 0; 6/6 checks passed
  (Node 22.22.2, onnxruntime 1.27.0, FTS5 ENABLED, sqlite-vec v0.1.9,
  embedding 384d, filesystem roundtrip).
- Root `npm run build-index -- --empty-ok`: **PASS** — exit 0;
  158ms for 0 skills.
- Root `npm run catalog:load -- --empty-ok`: **PASS** — exit 0;
  47ms for 0 skills.
- UI test: **PASS** — exit 0; 152/152 pass, duration 7.0s.
- SDK test: **PASS** — exit 0; 16/16 pass, duration 1.3s.
- `node --test test/augment/top-k.test.mjs`: **PASS** — exit 0;
  9/9 pass, duration 0.34s.
- `node --test test/augment/byte-string-determinism.test.mjs`:
  **PASS** — exit 0; 3/3 pass, summary line printed
  `[byte-string-determinism] 1000/1000 SHA-256 identical
  (baseline=c038eb79fcb9…)`, duration 0.66s.
- Inline Verifier stress sensor (K=5 × 1000 random RRF):
  **PASS** — 1 unique SHA-256, 0 drift, baseline
  `c038eb79fcb9961f291412a618534e8e45b6bf336db790ba1fc0388b3f4d071c`,
  elapsed 152ms.
- `node scripts/smoke-server-boot.mjs` (standalone,
  `MEMORY_STUDIO_AUGMENT_PORT_RANGE=42900-42900`): prints
  ```
  [PASS] boot smoke: http://127.0.0.1:42900/health → 200, status=ok, uptime_ms=158
  [PASS] boot smoke: bound URL parsed from stdout (no static port guess)
  [INFO] server log captured: Memory Studio augment server: http://127.0.0.1:42900
  ```
  then **HANGS** (process never exits). The script reaches the
  `await killChild(result.child); process.exit(0);` epilogue but the
  post-SIGKILL `while (child.exitCode === null) { await sleep(20); }`
  loop has no timeout and the child listener port is not released
  cleanly on Windows. (This was confirmed by stopping the timed-out
  bash task after observed hang.)

## Spec-anchored requirements

(Mapped per audit scope; the spec.md R-XX labels differ — see "Notes".)

- R-09 Top-K 3–5: **PASS**. `DEFAULT_MIN_K=3`, `DEFAULT_MAX_K=5`,
  truncation at 5, warning when below 3. Tests cover 7→5, 3, 2→warning,
  and 0→warning.
- R-10 Double threshold: **PASS**.
  `src/server/augment/thresholds.ts` applies
  `cosine_similarity >= 0.75` (DEFAULT_MIN_COSINE_SIMILARITY from
  `src/search/types.ts:22`) then FTS rank floor first, short-circuit
  on first failing gate via `continue`. Defaults confirmed at
  `src/search/types.ts:22,25`.
- R-11 Tiebreak D-006: **PASS**. `src/server/augment/top-k.ts:79-83`
  comparator is `a.slug.localeCompare(b.slug)` ASC (PRIMARY) then
  `b.rrfScore - a.rrfScore` DESC (SECONDARY on collision). The
  reversed-input test in `test/augment/top-k.test.mjs:121-151` proves
  the hard case. The K=5 × 1000 random-score sensor confirms the
  byte-string hash is invariant across score perturbations.
- R-12 2-block ephemeral: **PASS**. `src/server/augment/augmenter.ts:163-166`
  builds exactly two `{ type: 'text', text, cache_control: { type: 'ephemeral' } }`
  blocks; block 1 = personas, block 2 = skills + rules + context +
  warnings.
- R-13 SHA-256 determinism primitives: **PASS**. `src/server/augment/byte-string.ts`
  has `sortKeysDeep` (recursive key sort), `replacerNfc` (NFC-normalize
  string leaves), `JSON.stringify` no-indent, and `sha256Hex` via
  `node:crypto.createHash('sha256')` UTF-8. `canonicalSha256()` is the
  single-line entry used by the augmenter.
- R-14 fail-open: **PASS by code review**. `src/server/augment/pipeline.ts:111-128`
  wraps both `encodeQuery` and `runRetrieval` in `try/catch` and
  delegates to `failOpenResponse()` (line 210-236), which emits
  `emptyReason: 'timeout'` and a persona-only 2-block SHA-256.
  WARNING: there is **no explicit unit test** that simulates a
  retrieval exception and asserts `emptyReason === 'timeout'`. The
  iter 1 verdict also called R-14 PASS by code/tests reviewed; this
  is consistent but I am flagging the missing test as a coverage gap.

## Fix-tasks verification

- **FT-01 Tiebreak (G1 CRITICAL)**: **PASS**.
  - `src/server/augment/top-k.ts:79-83`: PRIMARY `a.slug.localeCompare(b.slug)`,
    SECONDARY `b.rrfScore - a.rrfScore`.
  - `test/augment/top-k.test.mjs`: 9/9 pass (includes a 50-iteration
    score-perturbation test and a 50-iteration score-REVERSAL test).
  - `test/augment/byte-string-determinism.test.mjs`: 3/3 pass,
    1000/1000 SHA-256 identical, baseline `c038eb79fcb9...`.
  - **My independent K=5 × 1000 random-score stress sensor
    (`test/.verifier-stress-ft01.mjs`, inlined)**:
    ```json
    {
      "iterations": 1000,
      "uniqueShaCount": 1,
      "driftCount": 0,
      "firstDriftSha": null,
      "baselineSha": "c038eb79fcb9961f291412a618534e8e45b6bf336db790ba1fc0388b3f4d071c",
      "elapsedMs": 152
    }
    ```
    Identical baseline `c038eb79fcb9…` in both my sensor and the
    authored test confirms the byte-string path is hooked to slug
    order, not score order. The iter-1 failure mode
    (RRF-DESC primary, slug secondary on ties) is gone.

- **FT-02 Smoke boot (G2 High)**: **FAIL (operational regression)**.
  - `scripts/smoke-server-boot.mjs` exists and boots the server,
    captures the URL from stdout (`Memory Studio augment server:
    http://127.0.0.1:<port>/`), curls `/health`, asserts
    `http-status-200` + `status-ok` + `uptime-ms-positive`, prints
    `[PASS]` lines.
  - The script's `[PASS]` lines ARE printed (verified standalone
    run): `http://127.0.0.1:42900/health → 200, status=ok,
    uptime_ms=158`. So the underlying server foundation + retrieval
    pipeline DO integrate end-to-end.
  - **But the script HANGS at `await killChild(result.child);
    process.exit(0);`** on Windows. The Implementer's claim that
    "Direct spawn + SIGTERM kills cleanly" is **wrong on this
    Windows host**: the post-SIGKILL
    `while (child.exitCode === null) { await sleep(20); }` loops
    indefinitely. Confirmed by running the smoke script standalone
    — it produced all `[PASS]` lines, then refused to exit (>30s).
  - When invoked via the test wrapper
    (`test/server/smoke-boot.test.mjs`), the wrapper's 30s SIGKILL
    timer fires; the test records
    `smoke script timed out after 30000ms` and the child process
    is left leaked. The second wrapper test
    (`leaves no orphan server after cleanup`) attempts another
    smoke cycle; that cycle's boot child fails to bind 42900
    (leaked listener), but appears to "succeed" against the
    leaked server because `/health` returns 200 from the original
    leaked child. The wrapper then observes code -1 (its own 30s
    timeout fired before the new child's smoke finished) and
    fails the assertion. Both `#191` and `#192` therefore FAIL
    in `npm test`.
  - This is a regression on this OS, not a Windows-only spec
    concern — the same code path could block on any host where
    SIGKILL does not synchronously reap the listener.

- **FT-03 Idempotent (G3 Medium)**: **FAIL (cascaded from FT-02)**.
  - `package.json#scripts.test:idempotent` is correctly set to
    `"npm test && npm test"`.
  - The script cannot run green on this host because `npm test`
    exits non-zero (FT-02). I did not run `npm run test:idempotent`
    end-to-end because it would have just confirmed the broken
    exit twice in a row.
  - If FT-02 is fixed in iter 3, FT-03 will pass mechanically —
    the script is a thin `&&` chain.

## Independent discrimination sensors

- **D-006 stress (FT-01)** — K=5 fixed set, 1000 random `rrfScore`
  draws, all matched-slug canonical-SHA-256 outputs compared:
  **PASS**, 1 unique SHA, 0 drift, 152ms. (Inline script:
  `test/.verifier-stress-ft01.mjs`.)
- **D-006 stress (end-to-end)** via `buildSystemMessage(baseRequest,
  { matched })`: 1000 perturbations, all SHA-256 identical —
  **PASS** in `test/augment/byte-string-determinism.test.mjs:131-168`.
- **Summary line** printed in test output:
  `[byte-string-determinism] 1000/1000 SHA-256 identical
  (baseline=c038eb79fcb9…)` — **observed**.
- **Smoke script standalone** (proves the boot + probe work in
  isolation): `[PASS] boot smoke: http://127.0.0.1:42900/health →
  200, status=ok, uptime_ms=158` — **observed**; but the script
  hangs after printing these lines.
- **Provider cache sanity**: not exercised (Phase 5b scope).

## Scope and regression audit

- `src/search/*` vs `9e48501..HEAD`: **empty diff** (PASS, per
  CALIBRATION-RESIDUE.md reuse-only mandate).
- `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`,
  `packages/sdk/**`, `packages/ui/**`: **empty diff** (PASS).
- Phase 5a.1 + 5a.2 touched files (per `git diff --stat
  9e48501..HEAD`): `src/server/augment.ts` (+177/-58) and the new
  `src/server/augment/{top-k,thresholds,retrieval,pipeline,
  augmenter,byte-string,response,types}.ts` (+1043) — consistent
  with the iter-1 expected layout.
- New FT infra: `scripts/smoke-server-boot.mjs` (208 lines) +
  `test/server/smoke-boot.test.mjs` (101 lines) + `package.json`
  test:idempotent (+1 line).
- New tests: `test/augment/{top-k,thresholds,retrieval,pipeline,
  augmenter,byte-string,byte-string-determinism}.test.mjs` — all
  under `test/augment/*` and `test/server/*`, per the audit's
  per-module convention.
- Modified tests: `test/server/smoke.test.mjs` (+1/-?, per the
  iter-1 comment "minimal diff adapting placeholder expectations").

## Idempotency

- `test/augment/top-k.test.mjs` + `test/augment/byte-string-
  determinism.test.mjs` were run twice each (the byte-string test
  uses a non-fixed seed and the assertion is per-run rather than
  frozen) — both pass on each invocation.
- The full root `npm test` is not idempotent on this host because
  the smoke wrapper leaks listeners between runs (test #192
  confirmed this).
- A targeted second pass of `node --test test/augment/*.test.mjs`
  was not measured, but the byte-string-determinism test trivially
  re-randomizes on each invocation.

## Ranked gaps

1. **HIGH — Fix smoke-script cleanup hang on Windows.** The script
   reaches `[PASS]` and probes `/health` correctly, but the
   `killChild()` epilogue never releases the child listener port
   after SIGTERM. Root cause is the unbounded
   `while (child.exitCode === null) { await sleep(20); }` loop
   after SIGKILL — that loop must have a hard timeout AND must
   `process.exit(1)` (not hang) so CI can proceed. A pragmatic
   fix: add a hard 2–3s timeout to that loop, then `process.exit(0)`
   unconditionally (the test passed and the kill failed — log it).
   Also consider using `taskkill /F /T /PID <child_pid>` on
   `process.platform === 'win32'` to guarantee the listener is
   released (the npm script comment already acknowledges this
   exact Windows tree-kill concern).
2. **HIGH — `npm test` exits non-zero.** Once #1 is fixed, `npm
   test` will be green (271 already pass; the 2 failing tests are
   the wrapper around the broken script).
3. **MEDIUM — Add an explicit retrieval-throws → `emptyReason:
   'timeout'` unit test.** The R-14 fail-open branch is
   implemented and exercised by the social/no-active paths, but a
   deliberate retrieval exception path is not covered. Suggest
   adding a `pipeline.test.mjs` test that injects a provider whose
   `db`/`embedder.encode`/`runRetrieval` throws and asserts
   `body.emptyReason === 'timeout'` and `statusCode === 200`.
4. **LOW — Remove the inline stress script** I created at
   `test/.verifier-stress-ft01.mjs` (kept for now — it produced
   the same baseline SHA-256 as the authored test and proves the
   invariant). It can be deleted before merge.

## Lesson signals

- **(new L-###)** "Score-independent tests must explicitly allow
  REVERSAL of score ordering, not just add a small offset." The
  iter-1 implementation passed `Math.random()*0.001` perturbations
  but failed the K=5 × 1000 random-`rrfScore` test. Iter-2 adopted
  `randomInt(0, 1000)` style permutation-wide stress. This is the
  same lesson iter 1 surfaced as "Determinism tests must perturb
  ranking scores while keeping the matched item set fixed and
  assert the serialized order/hash" — now confirmed by an
  independently-written stress sensor.
- **(cross-OS smoke gap)** Process-tree cleanup in Node's child
  process API is OS-fragile. Future smoke scripts should adopt
  the `taskkill /F /T` (Windows) / `pkill -P` (POSIX) pattern,
  plus a HARD post-SIGKILL timeout, and never rely on the final
  `process.exit(0)` being reached.
- **(wrapper-leak hazard)** A failing smoke that leaks the
  listener will cause its own assertion's "second run" test to
  also fail — masking whether the underlying script would have
  passed on a fresh host. Wrappers should disable the second-run
  leak-detection test when the first run timed out, or run the
  second run against a different port.

## Notes

- The audit scope uses its own R-09..R-14 mapping (Top-K /
  Threshold / Tiebreak / 2-block / SHA-256 / fail-open) which is
  NOT what the spec.md at lines 143-148 uses. spec.md uses
  R-09=Top-K, R-10=Tiebreak D-006, R-11=2-block, R-12=SHA-256,
  R-13=Active catalog validation, R-14=Social detector gate. I
  validated against the audit-scope mapping but also cross-checked
  the spec.md labels where the audit's R-13/14 differ.
- `test/augment/byte-string-determinism.test.mjs` is the right
  place for the K=5 × 1000 stress; it's already there with the
  preferred `node:crypto.randomInt` permutation. My
  `test/.verifier-stress-ft01.mjs` is a Verifier-only double-
  check that produced the same SHA-256 baseline; recommend
  deletion before merge.

---

**Files referenced (absolute paths):**
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\top-k.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\thresholds.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\pipeline.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\augmenter.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\byte-string.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\scripts\smoke-server-boot.mjs`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\server\smoke-boot.test.mjs`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\augment\top-k.test.mjs`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\augment\byte-string-determinism.test.mjs`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\pipeline.test.mjs`
  (renamed? — actual path: `test\augment\pipeline.test.mjs`)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\package.json`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\search\types.ts`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\features\phase-5a-api-retrieval\spec.md`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\features\phase-5a-api-retrieval\fix-tasks-phase-5a.2.md`
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\features\phase-5a-api-retrieval\validation-phase-5a.2.md`
