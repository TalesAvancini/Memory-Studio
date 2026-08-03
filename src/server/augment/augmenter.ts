/**
 * Augmenter — builds the 2-block `cache_control: ephemeral` system
 * message for the `/augment` response.
 *
 * Phase 5a.2 (T-08) — implements PRD §8 invariante 11:
 *
 *   Block 1 (stable prefix): persona(s) text joined by `\n\n`.
 *   Block 2 (variable suffix): Skills + Rules + matched items +
 *                              context synthesis joined by `\n\n`.
 *
 * Both blocks carry `cache_control: { type: 'ephemeral' }` so the
 * Anthropic server treats each block as a separate cacheable unit with
 * a 5-minute TTL. Memory Studio's role is to:
 *   - Build the EXACT 2-block structure that would be sent to Anthropic.
 *   - Compute SHA-256 hex of the canonical-JSON-serialized structure
 *     so the client can verify byte-string determinism (D-006).
 *
 * The `systemMessage` field in the response is the SHA-256 hex string.
 * The 2-block structure itself is returned alongside (`system`) for
 * Phase 5b's `/v1/messages` proxy, which will forward the actual
 * Anthropic request and surface `usage.cache_read_input_tokens`.
 */

import type { AugmentRequest, Context, MatchedSkill, MatchedRule, MatchedPersona, PruningDecisions } from './types.ts';
import type { RankedItem } from './retrieval.ts';
import { canonicalSha256 } from './byte-string.ts';
import { serializeIntel, type Intel } from '../fast-agent/index.ts';

/** A single Anthropic system block. */
export interface SystemBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control: { readonly type: 'ephemeral' };
}

/** A block partitioned by source (used by the response builder). */
export interface PartitionedMatched {
  readonly skills: ReadonlyArray<MatchedSkill>;
  readonly rules: ReadonlyArray<MatchedRule>;
  readonly personas: ReadonlyArray<MatchedPersona>;
}

/** 2-block system message output. */
export interface SystemMessageOutput {
  /** The 2-block structure. Both blocks carry `cache_control: ephemeral`. */
  readonly system: ReadonlyArray<SystemBlock>;
  /** SHA-256 hex of the canonical-JSON-serialized 2-block structure. */
  readonly sha256: string;
}

/** Options for `buildSystemMessage`. */
export interface BuildOptions {
  /**
   * Partitioned matched items (already filtered to active catalog +
   * above-threshold + top-K + tiebreak-sorted). The augmenter
   * partitions them by `kind` so each block carries the right
   * content type.
   */
  readonly matched: ReadonlyArray<RankedItem>;
  /**
   * Pre-built persona text override. When provided, the augmenter's
   * matched-persona partition is ignored and this text is used as
   * block 1's body. Used by the social / no-active-items fast paths
   * where the persona block is the only stable prefix.
   */
  readonly personaTextOverride?: string;
  /** Request context (drives block 2's "Context" section). */
  readonly context?: Context | null;
  /** Optional augmentation trace (e.g. warnings from top-K). */
  readonly warnings?: ReadonlyArray<string>;
  /**
   * Optional stable system prefix used only by the transparent proxy. The
   * bytes are placed before the persona in Block 1; when omitted, the
   * historical `/augment` byte baseline is unchanged.
   */
  readonly stablePrefixText?: string;
  /**
   * Phase 6b: Intel literal from the previous turn (set by the
   * pipeline via `getIntel(sessionId)`). When non-null AND non-empty
   * (D-005), the augmenter emits a `## Intel` section as the FIRST
   * section of Block 2 (per AD-006 + design §5). Empty/null/undefined
   * → section omitted entirely (preserves the no-intel baseline byte
   * string → cache hit invariant R-15).
   *
   * Block 1 (persona) is NEVER modified by this field — the cache hit
   * prefix stays stable across turns when persona is stable.
   */
  readonly intel?: Intel | null;
}

/** Re-export `PruningDecisions` so consumers can `import { PruningDecisions }` here. */
export type { PruningDecisions };

/**
 * Build the persona text (block 1 body). Joins the matched personas'
 * text by `\n\n` so the stable prefix is byte-identical across turns
 * (per PRD §8 invariante 11 + SPEC §IMod-7).
 *
 * When `personaTextOverride` is set (social / no-active-items paths),
 * it's used verbatim. This is the single hook the fail-open paths use
 * to short-circuit the persona resolution.
 */
function buildPersonaText(
  matched: ReadonlyArray<RankedItem>,
  personaTextOverride: string | undefined,
  stablePrefixText: string | undefined,
): string {
  const personaText = personaTextOverride !== undefined
    ? personaTextOverride
    : matched
        .filter((m) => m.kind === 'persona')
        .map((p) => p.text)
        .join('\n\n');

  if (stablePrefixText === undefined || stablePrefixText.length === 0) {
    return personaText;
  }
  if (personaText.length === 0) return stablePrefixText;
  return `${stablePrefixText}\n\n${personaText}`;
}

/**
 * Build the variable suffix (block 2 body). Sections are joined by
 * `\n\n` and only emitted when non-empty:
 *
 *   ## Intel            (Phase 6b — FIRST section when present)
 *   ## Skills
 *   ## Rules
 *   ## Context
 *   ## Warnings
 *
 * The `## Intel` section is emitted when the `intel` argument is
 * non-null AND at least one of its fields is non-empty (D-005
 * graceful degradation: empty intel = section omitted entirely, so
 * the no-intel baseline byte-string stays byte-identical to the
 * Phase 6a.2 byte-string).
 *
 * The Context block uses `canonicalJsonStringify` so byte-string
 * determinism is preserved when the same context is sent twice.
 * Warnings are appended (when present) so log observability
 * survives the round-trip.
 */
function buildVariableSuffix(
  matched: ReadonlyArray<RankedItem>,
  context: Context | null | undefined,
  warnings: ReadonlyArray<string> | undefined,
  intel: Intel | null | undefined,
): string {
  const sections: string[] = [];

  // ## Intel — FIRST section in Block 2 (R-10 + AD-006 #1).
  // Empty/null/undefined → section omitted (D-005). Empty literal
  // (D-005 sentinel) is also omitted so the byte-string stays
  // byte-identical to the no-intel baseline.
  if (
    intel !== null &&
    intel !== undefined &&
    (intel.agentState !== '' || intel.nextNeeds.length > 0 || intel.recentTopic !== '')
  ) {
    sections.push('## Intel\n' + serializeIntel(intel));
  }

  const skills = matched.filter((m) => m.kind === 'skill');
  const rules = matched.filter((m) => m.kind === 'rule');
  if (skills.length > 0) {
    sections.push('## Skills\n' + skills.map((s) => s.text).join('\n\n'));
  }
  if (rules.length > 0) {
    sections.push('## Rules\n' + rules.map((r) => r.text).join('\n\n'));
  }
  if (context !== undefined && context !== null) {
    sections.push('## Context\n' + canonicalSha256(JSON.stringify(context)) + '\n' + JSON.stringify(context));
  }
  if (warnings && warnings.length > 0) {
    sections.push('## Warnings\n' + warnings.map((w) => `- ${w}`).join('\n'));
  }
  return sections.join('\n\n');
}

/**
 * Build the 2-block `cache_control: ephemeral` system message and
 * compute its SHA-256 hex digest.
 *
 * The function is pure — it does NOT mutate `matched`, does NOT touch
 * the request body, does NOT log. All side effects (structured logging,
 * audit writes) live in the pipeline orchestrator.
 *
 * Context precedence: `options.context` wins when present; otherwise
 * the request's `context` is used. This lets the pipeline orchestrator
 * override (e.g. for fail-open paths) while tests can call
 * `buildSystemMessage(request, { matched })` and get the request's
 * context for free.
 */
export function buildSystemMessage(
  request: AugmentRequest,
  options: BuildOptions,
): SystemMessageOutput {
  const effectiveContext = options.context !== undefined ? options.context : request.context;
  const block1Text = buildPersonaText(
    options.matched,
    options.personaTextOverride,
    options.stablePrefixText,
  );
  const block2Text = buildVariableSuffix(
    options.matched,
    effectiveContext,
    options.warnings,
    options.intel,
  );

  const system: SystemBlock[] = [
    { type: 'text', text: block1Text, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: block2Text, cache_control: { type: 'ephemeral' } },
  ];

  return {
    system,
    sha256: canonicalSha256(system),
  };
}

/**
 * Partition the matched array by `kind` so the response builder can
 * populate `matchedSkills`, `matchedRules`, and `matchedPersonas`
 * independently. Each partition preserves the upstream order (already
 * tiebreak-sorted by `topKAndTiebreak`).
 *
 * Scores included in the public response are the cosine similarity
 * when available, else the RRF score as a stable fallback (R-08).
 */
export function partitionByKind(
  matched: ReadonlyArray<RankedItem>,
): PartitionedMatched {
  const skills: MatchedSkill[] = [];
  const rules: MatchedRule[] = [];
  const personas: MatchedPersona[] = [];
  for (const item of matched) {
    const score = item.cosineSimilarity ?? item.rrfScore;
    if (item.kind === 'skill') {
      skills.push({ id: item.slug, score, source: 'builtin' });
    } else if (item.kind === 'rule') {
      rules.push({ id: item.slug, score, critical: false });
    } else if (item.kind === 'persona') {
      personas.push({ id: item.slug, score, isDefault: false });
    }
  }
  return { skills, rules, personas };
}

/** Empty pruning decisions (5 arrays, all empty). */
export function emptyPruningDecisions(): PruningDecisions {
  return {
    rejectedByFloor: [],
    rejectedByBudget: [],
    rejectedByAttentionTier: [],
    rejectedByNegativeFeedback: [],
    rejectedByCriticalDropped: [],
  };
}
