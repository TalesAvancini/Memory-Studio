---
date: 2026-07-31
version: 1
description: "Independent verifier report for Phase 5a.2 retrieval pipeline."
explanation: |
  Re-runs the project gates and exercises the threshold, top-K, augmenter,
  canonical JSON, fail-open, and scope contracts. Evidence includes one
  independently discovered determinism failure in the requested 1000-score
  stress scenario.
---

# Validation — Phase 5a.2 Retrieval Pipeline

## Verdict

**FAIL**. The ordinary root, type, environment, build, UI, and SDK gates pass, and the implementation has the requested modules and threshold/cache structures. However, the independent K=5 / 1000 random-RRF-score stress sensor fails immediately: `topKAndTiebreak()` orders by score before serialization, so score perturbations change the serialized item order and SHA-256. The required invariant is score-independent byte-string determinism after the D-006 tiebreak.

## Gate evidence

- Root `npm test`: exit 0; TAP completed successfully (implemented root suite includes the 39 Phase 5a.2 tests).
- Root `npm run typecheck`: exit 0.
- Root `npm run verify-env`: exit 0; 6/6 checks passed.
- Root `npm run build-index -- --empty-ok`: exit 0; empty catalog index built.
- Root `npm run catalog:load -- --empty-ok`: exit 0; empty catalog loaded.
- UI test: exit 0 (output begins `@memory-studio/ui@0.0.0 test`, TAP success).
- SDK test: command batch exited 0; UI typecheck also exited 0.
- Server smoke: direct boot/probe did not expose `GET /health` on `127.0.0.1:4200` within the probe window; no stderr was emitted. This is an operational gap requiring follow-up rather than treated as a passing smoke.

## Spec-anchored requirements

- R-09 Top-K 3–5: **PASS for boundaries covered by implementation/tests**. `topKAndTiebreak()` truncates to 5 and warns below 3; test suite covers 7→5, 3, 2→2+warning, and 0→warning.
- R-10 Double threshold: **PASS**. `src/server/augment/thresholds.ts` checks inclusive cosine floor first, then FTS rank/hit floor; first failing gate short-circuits. Boundary cosine `0.75` passes and lower cosine rejects.
- R-11 Tiebreak D-006: **PARTIAL / FAIL as a complete determinism contract**. Code uses RRF DESC then `slug.localeCompare()` on equal scores, matching the documented implementation choice, but score ordering is retained in the final output and therefore leaks into byte-string order for non-tied scores.
- R-12 2-block ephemeral: **PASS**. `src/server/augment/augmenter.ts` creates exactly two text blocks; both carry `{ type: 'ephemeral' }`; persona text is block 1 and Skills/Rules/context are block 2.
- R-13 SHA-256 determinism: **PASS for canonical serialization primitives; FAIL for pipeline ordering stress**. `byte-string.ts` recursively sorts keys, NFC-normalizes string leaves, removes JSON whitespace, and hashes UTF-8. End-to-end score-independent ordering fails as described below.
- R-14 fail-open: **PASS by code/tests reviewed**. `pipeline.ts` catches retrieval-stage failures and constructs `timeout` with persona-only output rather than propagating a 500.

## Independent discrimination sensors

- Double threshold edge cases: **PASS** by code and tests: inclusive `>= 0.75`, FTS rank required, and cosine rejection short-circuits FTS evaluation.
- Top-K boundaries: **PASS** for 7, 3, 2, and empty candidate inputs.
- Canonical JSON key order/NFC/whitespace: **PASS** by implementation in `byte-string.ts`.
- Empty persona / two-block shape: **PASS** by augmenter tests and implementation.
- Retrieval exception path: **PASS** by pipeline fail-open branch review and tests.
- Same item set with random score perturbations: **FAIL**. Independent command with a fixed K=5 set and 1000 random RRF assignments produced `Error: drift 0` on the first iteration. The hash changed because `topKAndTiebreak()` sorts by `b.rrfScore - a.rrfScore`, while only equal scores invoke the slug tiebreak.

## Scope and regression audit

- `src/search/*` unchanged from `9e48501..HEAD`: **PASS** (empty diff).
- Root `package.json` unchanged from `9e48501..HEAD`: **PASS** (empty diff).
- Protected Phase 1/2/3/4 paths (`src/catalog`, `src/social-detector`, `src/fingerprint`, `packages/sdk`, `packages/ui`, and locked server foundation files checked): **PASS**; no diff output from the audited command.
- Implementer path choice: **PASS**. Implementation is under `src/server/augment/*`, consistent with `design.md`, despite the dispatch shorthand.
- Smoke test modification: **PASS/minimal**. The diff is limited to two assertions adapting placeholder expectations to real-pipeline behavior.
- Catalog wiring deferred: **PASS as a Phase 5a.2 deviation**. The in-memory/zero-vector approach is documented and production wiring is explicitly deferred.

## Idempotency

- Root test suite: **PASS** on the completed run.
- Required second complete augment-suite run: **NOT CONFIRMED** in this verifier pass; the root suite was run once. The independent stress sensor is already a deterministic failure.

## Ranked gaps

1. **Critical — fix byte-string ordering invariant.** After selecting the fixed matched set, canonicalize the item order independently of score (the required D-006 identifier order) before building the system message/hash, or otherwise ensure the pipeline's final serialized order cannot vary with RRF scores. Add/run the exact K=5 × 1000 random-score test.
2. **High — investigate server boot smoke.** `src/server/boot.ts` did not answer `/health` at the expected port during an independent probe and emitted no stderr. Re-run with captured stdout and the configured port range, then make the smoke outcome observable.
3. **Medium — run augment tests twice** and record both counts in the next validation report.

## Lesson signals

- Determinism tests must perturb ranking scores while keeping the matched item set fixed and assert the serialized order/hash, not merely perturb scores without checking order semantics.
- A passing unit test for equal-score tiebreak is insufficient evidence for score-independent determinism when the comparator intentionally sorts unequal scores first.
