/**
 * Fast Agent client — the in-process wrapper around the Anthropic
 * SDK for MiniMax-M2.7-highspeed intel extraction (Phase 6b R-01 +
 * R-02).
 *
 * Two execution paths:
 *
 *   1. **Real path** (when `MINIMAX_API_KEY` is set AND
 *      `@anthropic-ai/sdk` is installed AND the SDK is loadable):
 *      - POST to `https://api.minimax.io/anthropic` (the MiniMax
 *        Anthropic-compatible endpoint, verified Phase 5b.4).
 *      - `model = process.env.MEMORY_STUDIO_FAST_AGENT_MODEL ?? 'MiniMax-M2.7-highspeed'`.
 *      - Uses `zodResponseFormat(IntelSchema, 'intel')` for structured
 *        output so the response JSON conforms to SPEC §IMod-5.
 *      - `max_tokens = 256` (the structured-output payload is small).
 *
 *   2. **Stub path** (defensive fallback):
 *      - Returns `EMPTY_INTEL` (D-005 graceful sentinel). No HTTP.
 *      - Every log line is prefixed `[STUB]` so the operator can
 *        never confuse stub output with real API output.
 *
 * MODE is decided once at module load and logged to stdout via
 * `[fast-agent] MODE=real|stub endpoint=<url> model=<model>`.
 * Re-deciding on each call would burn the env-var lookup + filesystem
 * require.resolve — both O(1) but pointless when the wiring is
 * stable for the server's lifetime.
 *
 * The mode resolution is exported (`resolveMode`, `isSdkLoadable`)
 * for tests so the assertion can pin the mode without env-var
 * mutation.
 */

import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

import { EMPTY_INTEL, IntelSchema, type Intel } from './intel-schema.ts';

// In ESM Node 22 there is no top-level `require`. `createRequire`
// gives us a synchronous loader that's used ONLY for the SDK
// existence probe (`require.resolve`) — no path-level execution, so
// the runtime cost is a single `fs.stat` against `node_modules`.
const _require = createRequire(import.meta.url);

const API_KEY = process.env['MINIMAX_API_KEY'] ?? '';
const MODEL = process.env['MEMORY_STUDIO_FAST_AGENT_MODEL'] ?? 'MiniMax-M2.7-highspeed';
const ENDPOINT = 'https://api.minimax.io/anthropic';

export type Mode = 'real' | 'stub';

/**
 * Synchronous SDK presence probe. Better-sqlite3-style: catches
 * MODULE_NOT_FOUND so the function returns null cleanly when the
 * package is not installed.
 */
function probeSdkPackageName(): string | null {
  try {
    return _require.resolve('@anthropic-ai/sdk');
  } catch {
    return null;
  }
}

/**
 * Resolve the execution mode from env + SDK presence. Exported for
 * tests so the wiring can be pinned without env-var manipulation.
 */
export function resolveMode(apiKey: string | undefined = API_KEY, sdkPath: string | null = probeSdkPackageName()): Mode {
  if (!apiKey) return 'stub';
  if (!sdkPath) return 'stub';
  return 'real';
}

/**
 * Result of `fetchIntel`. `latencyMs` lets the writer/scheduling
 * code measure end-to-end latency for the cache hit invariant (R-12
 * POC budget is < 3s).
 */
export interface FastAgentResult {
  readonly intel: Intel;
  readonly latencyMs: number;
  readonly mode: Mode;
}

const MODE: Mode = resolveMode(API_KEY, probeSdkPackageName());

// Log once at module load. Subsequent calls do NOT re-log.
console.log(`[fast-agent] MODE=${MODE} endpoint=${ENDPOINT} model=${MODEL}`);

/**
 * Fetch the Intel literal for a prompt. The `prompt` is the R_N
 * text from the provider's response (or whatever the proxy passes).
 *
 * Real path: SDK call with structured output via
 * `zodResponseFormat(IntelSchema, 'intel')`.
 * Stub path: returns `EMPTY_INTEL` synchronously (no await, no
 * network).
 *
 * Errors are swallowed → return `EMPTY_INTEL` with the latency the
 * call consumed up to the failure. The request that scheduled the
 * fast-agent call is NEVER blocked (R-16 + R-20 fire-and-forget).
 */
export async function fetchIntel(prompt: string): Promise<Intel> {
  const t0 = performance.now();
  if (MODE === 'real') {
    try {
      const parsed = await callReal(prompt);
      const latencyMs = performance.now() - t0;
      console.log(`[fast-agent] real OK latency=${latencyMs.toFixed(1)}ms`);
      return parsed;
    } catch (err) {
      const latencyMs = performance.now() - t0;
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[fast-agent] real failed (latency=${latencyMs.toFixed(1)}ms): ${reason}; returning EMPTY_INTEL`);
      return EMPTY_INTEL;
    }
  }
  const latencyMs = performance.now() - t0;
  console.log(`[STUB] fetchIntel called prompt_length=${prompt.length} latency=${latencyMs.toFixed(1)}ms`);
  return EMPTY_INTEL;
}

/**
 * Create the Anthropic SDK client + invoke messages.create with the
 * structured-output Intel schema. The SDK is loaded dynamically so
 * the module can be imported in environments where the SDK isn't
 * installed (e.g., before T-07 has run `npm install`).
 *
 * `zodResponseFormat(IntelSchema, 'intel')` is the structured-output
 * bridge so the API returns a JSON literal matching SPEC §IMod-5.
 */
async function callReal(prompt: string): Promise<Intel> {
  // Dynamic import — resolves at call time. The package MAY not be
  // installed yet (Phase 6b T-07 wires the install), so the static
  // `import` form would crash at module load.
  //
  // The TS compiler cannot resolve these modules until `@anthropic-ai/sdk`
  // is in `node_modules`. Until T-07 runs `npm install @anthropic-ai/sdk`,
  // the imports look like `Cannot find module ...` to tsc. We use
  // a string-form specifier + a runtime cast to `unknown` to opt
  // out of TS resolution; the runtime check (`resolveMode`) ensures
  // the real path is only exercised when the SDK is present.
  const mod: { default: new (opts: { apiKey: string; baseURL: string }) => unknown } =
    // @ts-expect-error -- dynamic import resolves at runtime; T-07 installs the SDK
    await import('@anthropic-ai/sdk');
  const Anthropic = mod.default;
  type AnthropicInstance = InstanceType<typeof Anthropic>;
  type CreateArgs = {
    model: string;
    max_tokens: number;
    system: string;
    messages: ReadonlyArray<{ role: 'user'; content: string }>;
    // The SDK's helper returns a structured-output descriptor when
    // present (any key is fine; the wire JSON is opaque to us).
    [key: string]: unknown;
  };
  type ResponseLike = {
    content: ReadonlyArray<{ type: string; text: string }>;
  };

  const client = new Anthropic({ apiKey: API_KEY, baseURL: ENDPOINT }) as AnthropicInstance;
  const messages = (client as unknown as {
    messages: { create(args: CreateArgs): Promise<ResponseLike> };
  }).messages;

  // The Anthropic SDK ships `zodResponseFormat` as a helper that
  // produces a structured-output request. We import the helper
  // lazily through the SDK package's helper module — fallback to a
  // no-zod tool block if the helper module is unavailable (older SDK
  // versions).
  let tools: ReadonlyArray<unknown> = [];
  try {
    const helpers: { zodResponseFormat?: (schema: unknown, name: string) => unknown } =
      // @ts-expect-error -- see note above; T-07 installs the SDK
      await import('@anthropic-ai/sdk/helpers/zod');
    const zodResponseFormat = helpers.zodResponseFormat;
    if (typeof zodResponseFormat === 'function' && IntelSchema) {
      tools = [zodResponseFormat(IntelSchema, 'intel')];
    }
  } catch {
    // Older SDK or module path unavailable — fall back to plain
    // text-mode call (the response will be parsed defensively).
  }

  const SYSTEM_PROMPT = 'You are an intel-extraction agent. Read the user\'s response and emit a JSON literal matching { agentState: string, nextNeeds: string[], recentTopic: string }. Empty values are valid (string "", empty array). Output JSON only.';

  const args: CreateArgs = {
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    ...(tools.length > 0 ? { tools: tools as unknown as CreateArgs[string][] } : {}),
  };
  const response = await messages.create(args);
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return EMPTY_INTEL;
  }
  const result = IntelSchema.safeParse(parsedJson);
  if (!result.success) {
    return EMPTY_INTEL;
  }
  return result.data;
}

/** Test-only — expose the resolved MODE for assertions. */
export function getMode(): Mode {
  return MODE;
}

/** Test-only — expose the resolved MODEL + endpoint. */
export function getModel(): string {
  return MODEL;
}

export function getEndpoint(): string {
  return ENDPOINT;
}
