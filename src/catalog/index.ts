/**
 * Barrel for the catalog domain.
 *
 * Per design.md § 7, this is a documented exception to the "no barrel exports"
 * rule (CLAUDE.md). The catalog domain is the public surface of Phase 2 and
 * future domains will import from here for convenience (loader, embedder,
 * writer, schema). Prefer direct imports for tree-shaking when possible.
 */

export { loadSkillFromFile, loadSkillFromString, canonicalYamlString, hashContentYaml } from './loader.ts';
export type { SkillRecord, StoredSkill, SkillKind, RawSkillYaml } from './types.ts';
export { VALID_KINDS, SLUG_PATTERN } from './types.ts';
export { upsertSkill, embeddingToBuffer, bufferToEmbedding, readSkillById } from './writer.ts';
export type { UpsertAction, UpsertResult, UpsertOptions } from './writer.ts';
export { createSchema } from './schema.ts';
export { DeterministicStubEmbedder, cosineSimilarity, EMBEDDING_DIMENSIONS } from './embedder.ts';
export type { Embedder } from './embedder.ts';
export { LoaderError, WriterError, SchemaError, EmbedderError } from './errors.ts';