/**
 * Intel schema — the canonical representation of a "turn-end intel
 * snapshot" extracted from the provider's R_N by the fast-agent
 * module (Phase 6b).
 *
 * Per SPEC §IMod-5 (D-005) the literal shape is:
 *
 *   {
 *     agentState: string,
 *     nextNeeds: string[],
 *     recentTopic: string,
 *   }
 *
 * Empty values are GRACEFUL (D-005): `{ agentState: '', nextNeeds: [],
 * recentTopic: '' }` parses OK and the runtime treats it as "no intel
 * extracted" (buildVariableSuffix in augmenter.ts omits the `## Intel`
 * section).  Type drift between writer (fast-agent) and reader (match
 * pipeline) breaks inception silently — this module is the SOLE shape
 * gate: `IntelSchema` is the single runtime validator, `EMPTY_INTEL`
 * is the single sentinel, and `serializeIntel` / `deserializeIntel`
 * are the single wire/storage pair.
 *
 * `serializeIntel` uses `canonicalJsonStringify` from byte-string.ts
 * for byte-string determinism (D-006) so the `## Intel` section in
 * Block 2 stays hash-stable across 2 identical runs.
 *
 * `deserializeIntel` swallows JSON.parse + Zod parse failures and
 * returns `null` so the reader degrades gracefully (D-005 — never
 * crash the augment pipeline because of a corrupted intel row).
 *
 * Phase 6a T-10 already verified the schema validation patterns; this
 * module elevates them to the production surface and adds the
 * serialize/deserialize pair that round-trips the SQLite row.
 */

import { z } from 'zod';

import { canonicalJsonStringify } from '../augment/byte-string.ts';

/**
 * Canonical Intel literal type (SPEC §IMod-5 shape). Marked `readonly`
 * to surface accidental mutation at compile time (the pipeline builds
 * a new literal per turn; never mutate a persisted one).
 */
export type Intel = {
  readonly agentState: string;
  readonly nextNeeds: readonly string[];
  readonly recentTopic: string;
};

/**
 * Zod validator for the Intel literal. Strict — every field is
 * required and typed. Empty strings/arrays are valid (D-005 graceful
 * degradation), but missing fields or wrong types fail parse.
 *
 * This is the SOLE runtime shape validator. The writer validates
 * before persisting (T-06); the reader validates after deserializing
 * (T-02); the buildVariableSuffix branch in the augmenter does NOT
 * validate (it trusts the writer's prior validation).
 */
export const IntelSchema = z.object({
  agentState: z.string(),
  nextNeeds: z.array(z.string()),
  recentTopic: z.string(),
}) as z.ZodType<Intel>;

/**
 * D-005 graceful degradation sentinel. Used:
 *   - as the writer's "no intel extracted" output (src/server/fast-agent/client.ts)
 *   - as the `## Intel` section's conditional render gate
 *     (`buildVariableSuffix` in augmenter.ts)
 *   - as the schema contract test's no-op fixture
 */
export const EMPTY_INTEL: Intel = Object.freeze({
  agentState: '',
  nextNeeds: Object.freeze<string[]>([]) as unknown as readonly string[],
  recentTopic: '',
});

/**
 * Factory for the EMPTY_INTEL sentinel. Equivalent to the constant
 * for now but lets future code customize the empty literal without
 * callers hard-coding the shape.
 */
export function emptyIntel(): Intel {
  return EMPTY_INTEL;
}

/**
 * Serialize an Intel literal to canonical JSON. Used by:
 *   - the writer (writer.ts) when persisting next_needs as JSON
 *   - the buildVariableSuffix gate (augmenter.ts) when emitting the
 *     `## Intel` section value
 *   - the byte-string determinism tests (intel-injection.test.mjs)
 *
 * Canonical: key-sorted, NFC-normalized, no whitespace. Matches
 * Phase 5a.2 `canonicalJsonStringify` so the SHA-256 derived from
 * this output is byte-equal across hosts and across runs.
 */
export function serializeIntel(intel: Intel): string {
  return canonicalJsonStringify(intel);
}

/**
 * Deserialize a SQLite `intel` row back into an `Intel` literal.
 * Returns `null` on any failure:
 *
 *   - `JSON.parse(row.next_needs)` throws (corrupted JSON in DB)
 *   - `IntelSchema.safeParse(...)` returns `success === false`
 *     (type drift — the writer was upgraded and left incompatible
 *      rows, OR a malicious upstream wrote garbage)
 *
 * The caller (T-02 `getIntel`) treats `null` as "no intel for this
 * session" and skips Block 2's `## Intel` section. The augment
 * pipeline MUST NOT crash on a corrupted row (R-09 fail-open).
 */
export function deserializeIntel(row: {
  readonly agent_state: string;
  readonly next_needs: string;
  readonly recent_topic: string;
}): Intel | null {
  let nextNeedsParsed: unknown;
  try {
    nextNeedsParsed = JSON.parse(row.next_needs);
  } catch {
    return null;
  }
  const candidate: Intel = {
    agentState: row.agent_state,
    nextNeeds: Array.isArray(nextNeedsParsed) ? (nextNeedsParsed as string[]) : [],
    recentTopic: row.recent_topic,
  };
  const result = IntelSchema.safeParse(candidate);
  if (!result.success) {
    return null;
  }
  return result.data;
}
