/**
 * Bounded SSE parser/tee for the transparent /v1/messages proxy (T-03).
 *
 * Reads the upstream response body, relays every byte to a caller-supplied
 * sink as it arrives, and accumulates just enough state to surface
 * `usage.cache_read_input_tokens` plus the assistant text for the
 * response-side fast agent. No content of any individual event is logged.
 */
import { TextDecoder } from 'node:util';

export interface SseTeeOptions {
  /** Forward a single decoded text chunk. Always called with a valid UTF-8 string. */
  readonly onChunk?: (chunk: string) => void;
  /** Called when a usage block is fully parsed. */
  readonly onUsage?: (usage: {
    readonly cacheReadInputTokens: number | null;
    readonly cacheCreationInputTokens: number | null;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  }) => void;
  /** Called once the terminal `[DONE]` marker or end-of-stream arrives. */
  readonly onComplete?: () => void;
  /** Called when the parser detects malformed SSE. */
  readonly onParseError?: (error: Error) => void;
}

export interface SseTeeResult {
  /** Stream the upstream response body to a caller that returns the response stream. */
  readonly tee: (body: ReadableStream<Uint8Array> | null) => Promise<void>;
  /** Drive the parser directly with raw UTF-8 chunks. */
  readonly consumeChunks: (chunks: AsyncIterable<Uint8Array | undefined>) => Promise<void>;
  /** Latest non-negative usage values captured. */
  readonly usage: {
    cacheReadInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  /** Whether the stream ended cleanly with `[DONE]`. */
  readonly completed: boolean;
  /** Captured assistant text (bounded to 64 KiB to keep memory predictable). */
  readonly assistantText: string;
}

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;

function mergeUsage(
  current: SseTeeResult['usage'],
  next: SseTeeResult['usage'],
): SseTeeResult['usage'] {
  return {
    cacheReadInputTokens: pickNumber(next.cacheReadInputTokens, current.cacheReadInputTokens),
    cacheCreationInputTokens: pickNumber(next.cacheCreationInputTokens, current.cacheCreationInputTokens),
    inputTokens: pickNumber(next.inputTokens, current.inputTokens),
    outputTokens: pickNumber(next.outputTokens, current.outputTokens),
  };
}

function pickNumber(next: number | null, current: number | null): number | null {
  if (typeof next === 'number' && Number.isFinite(next) && next >= 0) return next;
  return current;
}

export function createSseTee(options: SseTeeOptions = {}): SseTeeResult {
  const usage: SseTeeResult['usage'] = {
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    inputTokens: null,
    outputTokens: null,
  };
  let completed = false;
  let assistantBuffer = '';
  const decoder = new TextDecoder('utf-8');
  // Per-event state. SSE format is `event:` line, then one or more
  // `data:` lines, then a blank line terminator. The event name must
  // be carried forward so the parsed JSON is dispatched under the
  // correct event name when the terminator fires.
  const bufferState = { text: '', currentEvent: null as string | null, dataLines: [] as string[] };

  function dispatchEvent(name: string | null, data: string[]): void {
    if (data.length === 0) return;
    const joined = data.join('\n');
    if (joined === '[DONE]') {
      completed = true;
      options.onComplete?.();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(joined);
    } catch (error) {
      options.onParseError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (!isObject(parsed)) return;
    // Anthropic SSE spec:
    //   - message_start: usage lives at parsed.message.usage
    //   - message_delta: usage lives at parsed.usage (top level)
    //   - all other events: no usage
    const usageSource = name === 'message_start'
      ? parsed['message']
      : (name === 'message_delta' ? parsed : null);
    const candidateUsage = readUsage(usageSource);
    if (candidateUsage !== null) {
      const next = mergeUsage(usage, candidateUsage);
      usage.cacheReadInputTokens = next.cacheReadInputTokens;
      usage.cacheCreationInputTokens = next.cacheCreationInputTokens;
      usage.inputTokens = next.inputTokens;
      usage.outputTokens = next.outputTokens;
      options.onUsage?.(usage);
    }
    if (name === 'content_block_delta' || name === 'content_block_start') {
      const deltaText = readTextDelta(parsed['delta']);
      if (deltaText !== null && assistantBuffer.length < MAX_TEXT_BYTES) {
        const trimmed = deltaText.length > MAX_TEXT_BYTES - assistantBuffer.length
          ? deltaText.slice(0, MAX_TEXT_BYTES - assistantBuffer.length)
          : deltaText;
        assistantBuffer += trimmed;
      }
    } else if (name === 'message_start') {
      const text = readMessageStartText(parsed['message']);
      if (text !== null && assistantBuffer.length < MAX_TEXT_BYTES) {
        const trimmed = text.length > MAX_TEXT_BYTES - assistantBuffer.length
          ? text.slice(0, MAX_TEXT_BYTES - assistantBuffer.length)
          : text;
        assistantBuffer += trimmed;
      }
    }
  }

  /**
   * Drive the parser from an arbitrary async iterable of raw UTF-8 chunks.
   * The relay uses this directly with the bytes the response stream emits;
   * the standalone `tee` helper wraps a `ReadableStream` for tests and
   * single-consumer use.
   */
  async function consumeChunks(
    chunks: AsyncIterable<Uint8Array | undefined>,
  ): Promise<void> {
    let buffer = bufferState.text;
    let currentEvent = bufferState.currentEvent;
    let dataLines = bufferState.dataLines;
    try {
      for await (const chunk of chunks) {
        if (chunk === undefined) continue;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.length > MAX_LINE_BYTES) {
            options.onParseError?.(new Error('SSE line exceeded max length'));
            continue;
          }
          options.onChunk?.(`${line}\n`);
          if (line.length === 0) {
            // Blank line: dispatch the accumulated event (if any).
            if (dataLines.length > 0) {
              dispatchEvent(currentEvent, dataLines);
              dataLines = [];
              currentEvent = null;
            }
            continue;
          }
          if (line.startsWith('event:')) {
            // Replace the current event name; the next data terminator
            // dispatches under it. Multiple event: lines in a single
            // record take the last value.
            currentEvent = line.slice('event:'.length).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
            continue;
          }
          if (line.startsWith(':')) {
            // Comment line (per SSE spec) — ignore.
            continue;
          }
          // Unknown field — ignore to stay forward-compatible.
        }
      }
      const tail = decoder.decode();
      if (tail.length > 0) buffer += tail;
      if (buffer.length > 0) {
        if (buffer.startsWith('data:')) dataLines.push(buffer.slice('data:'.length).trimStart());
        buffer = '';
      }
      if (dataLines.length > 0) {
        dispatchEvent(currentEvent, dataLines);
        dataLines = [];
        currentEvent = null;
      }
    } catch (error) {
      options.onParseError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      bufferState.text = buffer;
      bufferState.currentEvent = currentEvent;
      bufferState.dataLines = dataLines;
      if (!completed) {
        completed = true;
        options.onComplete?.();
      }
    }
  }

  async function tee(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (body === null) {
      completed = true;
      options.onComplete?.();
      return;
    }
    await consumeChunks(readBytes(body));
  }

  return {
    tee,
    consumeChunks,
    usage,
    get completed() { return completed; },
    get assistantText() { return assistantBuffer; },
  };
}

async function* readBytes(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readUsage(source: unknown): SseTeeResult['usage'] | null {
  if (!isObject(source)) return null;
  const usageBlock = isObject(source['usage']) ? source['usage'] : null;
  if (usageBlock === null) return null;
  return {
    cacheReadInputTokens: readNonNegative(usageBlock['cache_read_input_tokens']),
    cacheCreationInputTokens: readNonNegative(usageBlock['cache_creation_input_tokens']),
    inputTokens: readNonNegative(usageBlock['input_tokens']),
    outputTokens: readNonNegative(usageBlock['output_tokens']),
  };
}

function readNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readTextDelta(delta: unknown): string | null {
  if (!isObject(delta)) return null;
  if (delta['type'] !== 'text_delta') return null;
  return typeof delta['text'] === 'string' ? delta['text'] : null;
}

function readMessageStartText(message: unknown): string | null {
  if (!isObject(message)) return null;
  const content = message['content'];
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text']);
    }
  }
  return parts.length > 0 ? parts.join('') : null;
}
