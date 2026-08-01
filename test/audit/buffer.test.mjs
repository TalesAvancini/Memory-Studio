/**
 * AuditRingBuffer tests (Phase 5b T-08).
 *
 * Coverage:
 *   - Empty buffer: getDepth() === 0
 *   - Single enqueue: depth === 1, no immediate flush
 *   - 100 enqueues trigger count flush within 100ms
 *   - 50 enqueues: no immediate flush; flush after ~1100ms (time trigger)
 *   - Writer throws: events dropped, error captured, enqueue after
 *     error succeeds (fail-open semantics, D-007)
 *   - Capacity overflow: 10001 enqueues drop oldest with stderr line
 *   - getLastFlushTs: epoch ms after success, null after failure
 *   - Concurrent enqueue during flush: no events lost
 *   - start/stop lifecycle: stop() flushes remaining with 'shutdown'
 *
 * Uses an in-memory stub writer so tests don't need SQLite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditRingBuffer, FLUSH_COUNT_TRIGGER, FLUSH_TIME_MS, RING_BUFFER_CAPACITY } from '../../src/server/audit/buffer.ts';

/**
 * Stub writer that records calls and optionally throws.
 */
function makeStubWriter({ throwOnWrite = false } = {}) {
  const calls = [];
  let resolveWrite;
  const writes = [];
  let pending = [];
  const writer = {
    async writeBatch(events) {
      calls.push(events);
      pending.push(events);
      if (throwOnWrite) {
        throw new Error('stub writer forced failure');
      }
    },
    calls,
    writes,
    pending,
  };
  return writer;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEvent(overrides = {}) {
  return {
    ts: Date.now(),
    tenantIdHashed: 'abc123',
    redactedPromptHash: 'a'.repeat(64),
    matchedIds: [],
    pruningReasons: [],
    latencyMs: 0,
    fingerprint: {},
    payload: {},
    eventType: 'augment',
    ...overrides,
  };
}

test('buffer: empty buffer has depth 0', () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  assert.equal(buf.getDepth(), 0);
});

test('buffer: single enqueue increments depth and does not flush immediately', async () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  buf.enqueue(makeEvent());
  assert.equal(buf.getDepth(), 1);
  await sleep(50);
  assert.equal(writer.calls.length, 0, 'no immediate flush when count not reached');
});

test('buffer: 100 enqueues trigger count flush within 100ms', async () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  for (let i = 0; i < FLUSH_COUNT_TRIGGER; i += 1) {
    buf.enqueue(makeEvent({ ts: 1_000_000 + i }));
  }
  await sleep(150);
  assert.ok(writer.calls.length >= 1, 'at least one flush fired');
  const total = writer.calls.reduce((sum, batch) => sum + batch.length, 0);
  assert.equal(total, FLUSH_COUNT_TRIGGER, 'all 100 events flushed');
});

test('buffer: 50 enqueues do not flush immediately; flush after ~1100ms (time trigger)', async () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  for (let i = 0; i < 50; i += 1) {
    buf.enqueue(makeEvent({ ts: 1_000_000 + i }));
  }
  await sleep(200);
  assert.equal(writer.calls.length, 0, 'no flush yet at 200ms');
  await sleep(FLUSH_TIME_MS);
  assert.ok(writer.calls.length >= 1, 'time trigger fired within FLUSH_TIME_MS + epsilon');
  const total = writer.calls.reduce((sum, batch) => sum + batch.length, 0);
  assert.equal(total, 50, 'all 50 events flushed');
});

test('buffer: writer throws → events dropped, enqueue after error still succeeds (fail-open)', async () => {
  const writer = makeStubWriter({ throwOnWrite: true });
  const buf = new AuditRingBuffer(writer);

  // Capture stderr to verify the error message is logged.
  const origErr = console.error;
  const stderrLines = [];
  console.error = (...args) => {
    stderrLines.push(args.join(' '));
  };

  try {
    buf.enqueue(makeEvent({ ts: 1 }));
    buf.enqueue(makeEvent({ ts: 2 }));
    await buf.flush('manual');

    // Buffer is not poisoned — depth is back to 0 after flush.
    assert.equal(buf.getDepth(), 0, 'buffer depth cleared after flush');
    assert.equal(buf.getLastFlushTs(), null, 'lastFlushTs null after failure');

    // Enqueue after the error still works.
    buf.enqueue(makeEvent({ ts: 3 }));
    assert.equal(buf.getDepth(), 1, 'enqueue after error succeeds');

    const hasAuditError = stderrLines.some((line) => line.includes('[audit] write failed'));
    assert.ok(hasAuditError, 'stderr captures the audit write failure');
  } finally {
    console.error = origErr;
  }
});

test('buffer: capacity overflow drops oldest event with stderr line', async () => {
  // Monkey-patch the buffer's flush to a no-op so the count trigger
  // never fires during the synchronous enqueue loop — this lets the
  // buffer accumulate to RING_BUFFER_CAPACITY and exercise the
  // safety valve that drops the oldest event with a stderr line.
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  buf.flush = async () => {}; // override — no count/time flushes
  // Cancel any timer that enqueue may have started.
  buf.resetForTests();

  const origErr = console.error;
  const stderrLines = [];
  console.error = (...args) => {
    stderrLines.push(args.join(' '));
  };

  try {
    for (let i = 0; i < RING_BUFFER_CAPACITY + 1; i += 1) {
      buf.enqueue(makeEvent({ ts: i }));
    }
    assert.equal(buf.getDepth(), RING_BUFFER_CAPACITY, 'buffer clamped to capacity');

    const hasCapacityWarning = stderrLines.some((line) =>
      line.includes(`[audit] buffer at capacity (${RING_BUFFER_CAPACITY})`),
    );
    assert.ok(hasCapacityWarning, 'stderr captures capacity warning');
  } finally {
    console.error = origErr;
  }
});

test('buffer: getLastFlushTs returns epoch ms after success, null after failure', async () => {
  const successWriter = makeStubWriter();
  const successBuf = new AuditRingBuffer(successWriter);
  successBuf.enqueue(makeEvent({ ts: 1 }));
  await successBuf.flush('manual');
  const ts = successBuf.getLastFlushTs();
  assert.ok(typeof ts === 'number' && ts > 0, 'success: lastFlushTs is positive number');

  const failWriter = makeStubWriter({ throwOnWrite: true });
  const failBuf = new AuditRingBuffer(failWriter);
  failBuf.enqueue(makeEvent({ ts: 1 }));
  const origErr = console.error;
  console.error = () => {};
  try {
    await failBuf.flush('manual');
    assert.equal(failBuf.getLastFlushTs(), null, 'failure: lastFlushTs is null');
  } finally {
    console.error = origErr;
  }
});

test('buffer: concurrent enqueue during flush preserves no-event-loss invariant', async () => {
  let writeDelay = 10;
  const slowWriter = {
    async writeBatch(events) {
      await sleep(writeDelay);
      // record the events that were written so the test can verify
      this.calls.push(events);
    },
    calls: [],
  };

  const buf = new AuditRingBuffer(slowWriter);
  // Pre-fill the buffer to 99 events (one short of the count trigger).
  for (let i = 0; i < 99; i += 1) {
    buf.enqueue(makeEvent({ ts: i }));
  }
  // The 100th enqueue triggers a count flush. We then enqueue more
  // events WHILE the flush is in flight. The new events must land in
  // the fresh buffer (not in the flushed batch).
  buf.enqueue(makeEvent({ ts: 99 }));
  // The count flush kicks off async; immediately add more.
  buf.enqueue(makeEvent({ ts: 100 }));
  buf.enqueue(makeEvent({ ts: 101 }));

  await sleep(50);
  assert.equal(slowWriter.calls.length, 1, 'exactly one flush fired');
  const firstBatch = slowWriter.calls[0];
  assert.equal(firstBatch.length, 100, 'first batch is 100 events (no new ones leaked in)');
  // Buffer still holds the post-flush events.
  assert.equal(buf.getDepth(), 2, 'buffer holds the post-flush events');
});

test('buffer: stop() flushes remaining events with shutdown reason', async () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  buf.enqueue(makeEvent({ ts: 1 }));
  buf.enqueue(makeEvent({ ts: 2 }));
  await buf.stop();
  assert.equal(writer.calls.length, 1, 'exactly one flush fired on stop');
  assert.equal(writer.calls[0].length, 2, 'both events flushed');
  assert.equal(buf.getDepth(), 0, 'buffer empty after stop');
});

test('buffer: snapshot returns depth + capacity + lastFlushTs', () => {
  const writer = makeStubWriter();
  const buf = new AuditRingBuffer(writer);
  buf.enqueue(makeEvent({ ts: 1 }));
  const snap = buf.snapshot();
  assert.deepEqual(
    Object.keys(snap).sort(),
    ['capacity', 'depth', 'lastFlushTs'].sort(),
  );
  assert.equal(snap.capacity, RING_BUFFER_CAPACITY);
  assert.equal(snap.depth, 1);
  assert.equal(snap.lastFlushTs, null, 'no flush yet');
});