---
date: 2026-08-03
version: 1
description: "T-07 user-friendly handoff — practical manual for the 7-day wall-clock acceptance phase. Companion to runbook.md (which is the formal operator doc); this file is the conversational reference for the human + the post-compaction orchestrator."
audience: "human operator (during T-07) + orchestrator agent (post-compaction)"
related:
  - ./runbook.md (formal operator runbook — more rigorous, less narrative)
  - ./spec.md (Phase 7b contracts + 4 PRD §10.2 budgets)
  - ../../STATE.md
  - ../../../handoff-orchestrator.md
  - ../../../CLAUDE.md
---

# T-07 — Operator Handoff (Practical Manual)

> **Reading order:**
> 1. **If you are the human** running the 7 days: read sections §1, §2, §3, §5 in order. Skim §4.
> 2. **If you are the post-compaction orchestrator**: read §1 (where we are), §6 (common pitfalls), §7 (snapshot schema), §8 (how to dispatch T-08).

---

## §1. Where we are

Memory Studio Phase 7b.1 (T-01..T-06) is **DONE and VERIFIED PASS** (commit `71a137d`). The scaffolding works end-to-end:

- `GET /health` — returns 200 with `catalog: { count: 17 }` in production mode
- `GET /metrics` — exposes the 5 metrics: `request_hit_rate`, `token_cache_coverage`, `p50_latency_ms`, `p99_latency_ms`, `working_set_mb`
- `POST /augment` — returns real retrieval matches from the catalog (verified via manual probe after the FTS5/vec schema-drift fix in commits `73d3ef1` + `361e735`)
- `POST /v1/messages` — transparent proxy to Anthropic-format endpoints (used when you point Claude Code / Mavis / Cursor at Memory Studio)

**T-07 is now active: 7-day real-traffic acceptance gate.** Memory Studio must serve real coding-agent traffic for 7 days, with snapshots taken throughout, and the metrics must satisfy PRD §10.2 budgets.

---

## §2. What you do during T-07

### Pre-flight (Day 0 — once)

```bash
cd "C:/Users/User/Desktop/AI-Project/Memory-Studio"

# 1. Confirm git state is clean
git status
git log -1 --oneline    # should be 73d3ef1 or later

# 2. Verify the catalog DB is up to date
npm run build-index
# expected: "added=0 updated=0 deleted=0 skipped=0" if already up to date
# OR "added=N" if catalog changed since last build

# 3. Confirm .env is correct
cat .env
# Must contain (with your values):
#   MEMORY_STUDIO_FAST_AGENT_API_KEY=...
#   MEMORY_STUDIO_FAST_AGENT_MODEL=MiniMax-M2.7-highspeed
#   MEMORY_STUDIO_FAST_AGENT_BASE_URL=https://api.minimax.io/anthropic
#   MEMORY_STUDIO_CATALOG_DB_PATH=C:/.../Memory-Studio/data/memory-studio.sqlite
#   MEMORY_STUDIO_STATE_PATH=C:/.../Memory-Studio/.memory-studio/state.json
#   MEMORY_STUDIO_CATALOG_DIR=C:/.../Memory-Studio/config/catalog

# 4. Boot Memory Studio
npm run server:start
# Look for "[boot] runtime MODE=production" in stdout
# If you see "MODE=stub" — MEMORY_STUDIO_CATALOG_DB_PATH is missing or invalid.

# 5. Verify health
curl http://127.0.0.1:42900/health
# Should show: "catalog":{"count":17}

# 6. Verify augment (the smoke)
curl -s -X POST http://127.0.0.1:42900/augment \
  -H 'content-type: application/json' \
  -d '{"prompt":"refactor TypeScript","context":null,"fingerprint":{"projectPath":".","agentId":"claude-code","sessionId":"smoke","gitBranch":"main"},"activeCatalog":["skill-typescript-strict"],"tenantId":"smoke","schemaVersion":3}'
# Should show "matchedSkills" non-empty
```

### During the 7 days

```bash
# Boot Memory Studio (do this once per session, or leave it running)
npm run server:start

# Wire Claude Code / Mavis / Cursor to use Memory Studio as the proxy
# (in another terminal, in another repo)
export ANTHROPIC_BASE_URL=http://127.0.0.1:42900
cd /path/to/your/work
claude  # or your coding agent

# Work normally — code, commit, debug, refactor
# Memory Studio will intercept each /v1/messages call, augment the
# system prompt with relevant skills/rules/personas from the catalog,
# forward to MiniMax-M2.7-highspeed, and return the response.

# At the end of each session, capture a snapshot:
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:42900 \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots

# Snapshots are timestamped JSON files in .specs/acceptance/snapshots/
# Each one captures: 5 metrics + audit summary + window metadata
```

### What counts as "real traffic"

- ✅ Coding your own project (commits, tests, debugging)
- ✅ Reading PRs and responding
- ✅ Working through a tutorial / learning session
- ✅ Refactoring existing code

What does NOT count:
- ❌ Running canned benchmark scripts
- ❌ Repeatedly querying the same prompt to inflate metrics
- ❌ Switching to stub mode mid-run
- ❌ Hand-editing audit counters

The acceptance gate rejects synthetic / stub evidence. Real means real.

### Minimum evidence for closure

| Requirement | Threshold |
|---|---|
| Wall-clock span | ≥ 7 × 24 hours between first and last snapshot |
| Distinct sessions | ≥ 5 (each with stable identity via `x-memory-studio-session-id`) |
| Total qualifying turns | ≥ 50 |
| Provider mode | `anthropic-real` (or your real provider — must NOT be stub) |
| Fast-agent mode | `real` (or stub if you deliberately accept reduced evidence) |
| Runtime mode | `production` |

---

## §3. What to do if something breaks

### Server won't boot

```bash
# Check the log
tail -50 /path/to/server/output

# Common causes:
# 1. "MODE=stub" but you wanted production → MEMORY_STUDIO_CATALOG_DB_PATH missing
# 2. "Cannot find directory config/catalog" → MEMORY_STUDIO_CATALOG_DIR missing
# 3. Port 42900 already in use → kill the other process or change port range
# 4. ONNX model download failed → check internet + re-run npm run build-index
```

### `/augment` returns `matchedSkills: []`

- **Catalog is empty** — `npm run build-index` to reload
- **activeCatalog in state.json is wrong** — edit `.memory-studio/state.json` and restart server
- **Thresholds too strict** — `minCosineSimilarity: 0.6` is fine for short queries; lower to `0.3` for natural-language queries
- **FTS5/vec schema drift** — if you see "no such table: content_fts", the schema fix from `73d3ef1` is missing — `git log` to verify

### `/v1/messages` errors with proxy

- **502** — upstream failed. Check `MEMORY_STUDIO_ANTHROPIC_BASE_URL` is reachable.
- **503 proxy_disabled** — base URL not set. Set `MEMORY_STUDIO_ANTHROPIC_BASE_URL` in `.env`.
- **504 timeout** — fast-agent took too long. Check `MEMORY_STUDIO_FAST_AGENT_BASE_URL` + API key.

### Snapshot script fails

```bash
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:42900 \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots
```

Common failures:
- "Connection refused" → server not running
- "DB not found" → path wrong
- "state.json not found" → path wrong
- "permission denied" → Windows UAC; run as admin or pick a writable path

### Metrics look wrong

- **All zeros** — no traffic yet. Wait for `/v1/messages` calls to flow.
- **`request_hit_rate: null`** — fewer than 10 requests in the window. Drive more.
- **`working_set_mb > 1500`** — memory leak; restart server, capture snapshot, escalate.
- **`p50_latency_ms > 50`** — investigate slow stages (`latencyMs.embedding`, `.retrieval`, `.rerank`).

---

## §4. Reading the metrics

`GET /metrics` returns:

```json
{
  "request_hit_rate": 0.65,        // fraction of /augment with matches
  "token_cache_coverage": 0.42,    // fraction of /v1/messages with cache hits
  "p50_latency_ms": 12.4,
  "p99_latency_ms": 89.1,
  "working_set_mb": 312,
  "window": { "request_count": 47, "proxy_request_count": 23 },
  "proxy_enabled": true,
  "schema_version": 2,
  "timestamp": 1785780080672,
  "evidence": {                   // raw counters, exposed since Phase 7b T-04
    "matched_requests": 31,
    "attempted_requests": 47,
    "cache_hit_requests": 10,
    "proxy_requests": 23,
    "latency_sample_count": 47,
    "process_started_at": 1785700000000
  }
}
```

**What to watch:**
- `request_hit_rate`: should be ≥ 0.70 by end of week. Lower means catalog is missing what you need → add skills.
- `token_cache_coverage`: should be ≥ 0.60 by end of week. Lower means prompts aren't cache-friendly → review system prompt stability.
- `p50_latency_ms`: should be < 50. Spike at start of session is normal (cold start); sustained high means something is slow.
- `working_set_mb`: should stay < 1500. Stable over time = good. Climbing = potential leak.

---

## §5. End of T-07 — what to send back

After 7 days:

```bash
# 1. Verify all snapshots are in place
ls -la .specs/acceptance/snapshots/

# 2. Check the acceptance gate (read-only)
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
# Look for "verdict=PASS" + "eligible_for_phase_closure=true"

# 3. Commit the snapshots
git add .specs/acceptance/snapshots/
git commit -m "phase-7b T-07: 7-day wall-clock evidence collected"

# 4. Send me (the orchestrator) a message with:
#    - "T-07 complete"
#    - The acceptance-gate verdict
#    - Any anomalies / observations
# I will dispatch T-08 (autonomous final hydration) next.
```

If `verdict=FAIL`, the failing budget IDs are listed on stderr. We then discuss:
- Is the budget realistic given your workload?
- Should the catalog be tuned?
- Should the thresholds be relaxed (with new evidence)?

---

## §6. Common pitfalls (for the post-compaction orchestrator)

When the user pings you mid-T-07, expect these:

1. **"How do I know if my snapshots are valid?"** — Run `node scripts/acceptance-gate.mjs --snapshots .specs/acceptance/snapshots --state .memory-studio/state.json`. Look for "eligible_for_phase_closure: true" (NOT verdict=PASS alone — closure also requires enough sessions, span, and non-synthetic mode).

2. **"I forgot to capture a snapshot yesterday"** — T-07 needs wall-clock SPAN ≥ 7 days. If a day was missed, capture an extra session today. Don't backdate.

3. **"My fast-agent stayed in stub mode"** — Provider mode in snapshots will be `stub`. The gate treats `stub` as lower-tier evidence (still counts but degrades). If the user wants real mode but their API key isn't accepted, surface this as a discovery (`AD-011` or similar).

4. **"Working set is climbing"** — Could be Windows-specific RSS behavior (RSS grows monotonically on Windows per Phase 7a Verifier note). Encourage the user to compare across server restarts, not within a single long-lived process.

5. **"I edited .memory-studio/state.json mid-run"** — Threshold changes during the run break the "single threshold epoch" invariant. The gate may treat this as a new epoch (≥ 2 sessions, ≥ 20 turns per epoch). If they changed thresholds, document the boundary snapshot.

6. **"Should I add more skills to the catalog?"** — Yes, freely. Run `npm run build-index` after editing YAMLs in `config/catalog/`. Server will pick up on next start. New entries don't invalidate previous snapshots.

7. **"Server crashed mid-session"** — Restart with `npm run server:start`. Note the downtime in your session log. The metrics reset on restart (intentional — they're per-process).

8. **"I'm not using Claude Code, I'm using Cursor / Mavis / another agent"** — All work. Memory Studio speaks Anthropic-format Messages API, so any agent that can be pointed at a custom `ANTHROPIC_BASE_URL` works.

---

## §7. Snapshot schema (for the orchestrator)

Each snapshot in `.specs/acceptance/snapshots/<ISO>.json`:

```json
{
  "captured_at": "2026-08-10T15:30:00.000Z",
  "source": "real",
  "provider_mode": "anthropic-real",
  "fast_agent_mode": "real",
  "runtime_mode": "production",
  "metrics": { /* /metrics response at capture time */ },
  "audit_summary": {
    "total_events": 247,
    "distinct_sessions": 5,
    "earliest_event_at": "2026-08-03T15:00:00.000Z",
    "latest_event_at": "2026-08-10T15:25:00.000Z"
  },
  "state_thresholds": {
    "minCosineSimilarity": 0.6,
    "minFtsHits": 1
  },
  "schema_version": 2
}
```

Read with `node --experimental-strip-types -e "import {readFileSync} from 'node:fs'; console.log(JSON.parse(readFileSync('.specs/acceptance/snapshots/<file>.json', 'utf8')))"`.

---

## §8. Dispatching T-08 (for the post-compaction orchestrator)

Once the user reports T-07 complete:

```bash
# 1. Verify all snapshots are committed
ls .specs/acceptance/snapshots/ | wc -l   # expect ≥ 5
git log --oneline .specs/acceptance/snapshots/ | head

# 2. Run the acceptance gate (production mode, not --allow-synthetic)
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
# MUST exit 0 with eligible_for_phase_closure: true

# 3. If PASS: dispatch T-08 (autonomous final hydration)
# T-08 generates acceptance-2026-MM-DD.md from the snapshots,
# freezes .memory-studio/state.json with final thresholds,
# and prepares the Phase 7b final closeout.
```

If the gate fails, surface the failing budget IDs to the user. Do NOT skip the gate — it's the closure proof.

---

## §9. Decision tree (when in doubt)

```
User asks "are we good?" during T-07
├── snapshots ≥ 5 with span ≥ 7 days? → check gate verdict
│   ├── verdict=PASS + eligible_for_phase_closure=true → ready for T-08
│   └── verdict=FAIL → read failing budgets, suggest tuning
└── snapshots < 5 or span < 7 days → "keep going, more sessions needed"

User asks "should I restart the server?"
├── Only if it's crashed or in stub mode when it shouldn't be → yes
└── Otherwise → NO. Restart resets metrics. Lossy.

User asks "should I tweak thresholds?"
├── During week 1 → NO. Lock thresholds for first epoch (≥ 2 sessions).
└── After week 1 → maybe. Capture boundary snapshot, then change ONE field.

User asks "Memory Studio is broken"
├── Check server log
├── Run the 3 probes (health, augment, metrics)
├── If error mentions schema → escalate (likely needs a fix commit)
└── If error mentions snapshot → user-side issue (path, perm)
```

---

## §10. When T-07 ends

After 7 days:
1. User commits snapshots + sends "T-07 complete" message
2. Orchestrator verifies acceptance gate exits 0
3. Orchestrator dispatches T-08
4. T-08 produces `acceptance-2026-MM-DD.md` (final report)
5. Phase 7b flips to `[x]` in ROADMAP
6. **Memory Studio is declared production-ready**

Memory Studio does NOT need any further engineering after T-08. The PRD's MVP acceptance criteria are satisfied. The catalog is operational. Real traffic has been measured. Done.

---

**End of handoff. Any unclear? Ping me (the orchestrator) with the section number (§X).**
