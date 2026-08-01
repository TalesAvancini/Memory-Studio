/**
 * POST /state/toggle endpoint (Phase 5b T-10).
 *
 * Implements R-08 (PRD §7.2) — toggles a catalog item on/off in the
 * project `.memory-studio/state.json`. Critical Rules require explicit
 * confirmation (`critical_confirm` matches the item's `critical_confirm_phrase`
 * or defaults to `OVERRIDE: <itemId>`).
 *
 * Concurrency: a Promise-based `class Mutex` (inlined here; no new
 * dependency) serializes the read-validate-write cycle. Concurrent
 * toggles produce a monotonic `stateVersion` counter so callers can
 * detect dropped writes.
 *
 * Atomicity: the write goes through `writeFile` to a `.tmp` sibling
 * followed by `rename`, which is atomic on POSIX and near-atomic on
 * Windows (the file is replaced in a single FS syscall).
 *
 * Audit: a `state_toggle` audit event is enqueued with the same shape
 * as other audit events. The `payload` carries `{itemId, action,
 * active, stateVersion, wasAlreadyActive}`.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';
import { hashTenantId } from '../security/tenant-hash.ts';
import { getAuditBuffer } from '../audit/lifecycle.ts';
import type { AuditEvent } from '../audit/types.ts';

export const StateToggleRequestSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(['on', 'off']),
  critical_confirm: z.string().optional(),
});
export type StateToggleRequest = z.infer<typeof StateToggleRequestSchema>;

export interface StateToggleResponse {
  itemId: string;
  action: 'on' | 'off';
  active: boolean;
  stateVersion: number;
}

export interface StateToggleRouteOptions {
  stateJsonPath: string;
  catalogDir: string;
  /** Optional DB handle — when present, the audit event is enqueued. */
  db?: Database;
  /** Optional latency sink for tests. */
  now?: () => number;
}

interface StateJsonShape {
  schemaVersion: number;
  activeCatalog: string[];
  stateVersion: number;
  [key: string]: unknown;
}

const DEFAULT_STATE: StateJsonShape = {
  schemaVersion: 3,
  activeCatalog: [],
  stateVersion: 0,
};

// --- Mutex (inline; no new dep) ---------------------------------------------

class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.current;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.current = previous.then(() => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const toggleMutex = new Mutex();

// --- State IO ---------------------------------------------------------------

async function readState(path: string): Promise<StateJsonShape> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.activeCatalog) ||
      typeof parsed.schemaVersion !== 'number'
    ) {
      return { ...DEFAULT_STATE };
    }
    return {
      ...DEFAULT_STATE,
      ...parsed,
      activeCatalog: parsed.activeCatalog.filter((s: unknown) => typeof s === 'string'),
      stateVersion: typeof parsed.stateVersion === 'number' ? parsed.stateVersion : 0,
    };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return { ...DEFAULT_STATE };
    }
    throw err;
  }
}

async function writeStateAtomic(path: string, state: StateJsonShape): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, path);
}

// --- Catalog item resolution ------------------------------------------------

/**
 * Resolve an itemId against the on-disk catalog YAML directory. Returns
 * `{exists, critical, critical_confirm_phrase}`. The `critical` flag is
 * read from the YAML file's `critical: true|false` line. The
 * `critical_confirm_phrase` is read from an optional
 * `critical_confirm_phrase: <string>` line (defaults to
 * `OVERRIDE: <itemId>`).
 */
async function resolveCatalogItem(
  catalogDir: string,
  itemId: string,
): Promise<
  | { exists: true; critical: boolean; criticalConfirmPhrase: string }
  | { exists: false }
> {
  const path = join(catalogDir, `${itemId}.yaml`);
  if (!existsSync(path)) {
    return { exists: false };
  }
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { exists: false };
  }
  let critical = false;
  let criticalConfirmPhrase = `OVERRIDE: ${itemId}`;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.length === 0) continue;
    if (/^critical\s*:\s*true\s*$/i.test(trimmed)) {
      critical = true;
    }
    const phraseMatch = /^critical_confirm_phrase\s*:\s*"?([^"]+)"?\s*$/i.exec(trimmed);
    if (phraseMatch !== null) {
      criticalConfirmPhrase = phraseMatch[1] ?? criticalConfirmPhrase;
    }
  }
  return { exists: true, critical, criticalConfirmPhrase };
}

// --- Audit ------------------------------------------------------------------

function enqueueAuditSafe(event: AuditEvent): void {
  try {
    const buf = getAuditBuffer();
    buf?.enqueue(event);
  } catch {
    // Audit is best-effort.
  }
}

// --- Route registration -----------------------------------------------------

export async function registerStateToggleRoute(
  app: FastifyInstance,
  opts: StateToggleRouteOptions,
): Promise<void> {
  app.post('/state/toggle', async (request, reply: FastifyReply) => {
    const parsed = StateToggleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: {
          code: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Invalid body',
          field: parsed.error.issues[0]?.path.join('.') ?? null,
        },
      };
    }

    const body = parsed.data;

    const item = await resolveCatalogItem(opts.catalogDir, body.itemId);
    if (!item.exists) {
      reply.code(404);
      return { error: 'item_not_found', itemId: body.itemId };
    }

    if (body.action === 'off' && item.critical && body.critical_confirm !== item.criticalConfirmPhrase) {
      reply.code(400);
      return {
        error: 'critical_confirm_required',
        itemId: body.itemId,
        hint: `POST with critical_confirm: '${item.criticalConfirmPhrase}'`,
      };
    }

    const result = await toggleMutex.runExclusive(async () => {
      const current = await readState(opts.stateJsonPath);
      const alreadyActive = current.activeCatalog.includes(body.itemId);
      let nextActiveCatalog: string[];
      if (body.action === 'on') {
        nextActiveCatalog = alreadyActive
          ? current.activeCatalog
          : [...current.activeCatalog, body.itemId];
      } else {
        nextActiveCatalog = alreadyActive
          ? current.activeCatalog.filter((id) => id !== body.itemId)
          : current.activeCatalog;
      }
      const nextVersion = (current.stateVersion ?? 0) + 1;
      const nextState: StateJsonShape = {
        ...current,
        schemaVersion: current.schemaVersion ?? 3,
        activeCatalog: nextActiveCatalog,
        stateVersion: nextVersion,
      };
      await writeStateAtomic(opts.stateJsonPath, nextState);
      const active = nextActiveCatalog.includes(body.itemId);
      return {
        response: {
          itemId: body.itemId,
          action: body.action,
          active,
          stateVersion: nextVersion,
        } satisfies StateToggleResponse,
        wasAlreadyActive: alreadyActive,
        active,
      };
    });

    enqueueAuditSafe({
      ts: Date.now(),
      tenantIdHashed: hashTenantId('state-toggle-tenant') ?? '',
      redactedPromptHash: hashTenantId(result.response.itemId) ?? '',
      matchedIds: [],
      pruningReasons: [],
      latencyMs: 0,
      fingerprint: { agentId: 'claude-code', source: 'state-toggle' },
      payload: {
        itemId: result.response.itemId,
        action: result.response.action,
        active: result.active,
        stateVersion: result.response.stateVersion,
        wasAlreadyActive: result.wasAlreadyActive,
      },
      eventType: 'state_toggle',
    });

    reply.code(200);
    return result.response;
  });
}

/** Test-only — reset module-scoped mutex state between runs. */
export function resetStateToggleForTests(): void {
  // Mutex is stateless; this hook is kept for parity with other routes.
  void toggleMutex;
}
