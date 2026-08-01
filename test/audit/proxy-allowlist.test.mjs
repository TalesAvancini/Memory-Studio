/**
 * proxy-allowlist unit tests (Phase 5b T-12).
 *
 * Coverage:
 *   - Loopback allowed: 127.0.0.1, localhost, ::1
 *   - Non-loopback rejected: api.anthropic.com, example.com
 *   - IPv6 bracket form `http://[::1]/...` parses correctly
 *   - Invalid URL → rejected
 *   - Empty hostname → rejected
 *   - Wildcard `*` rejected
 *   - CSV allowlist extension: replaces default loopback set
 *   - Case-insensitive hostname comparison
 *   - Port-in-URL allowed for loopback
 *   - assertLoopback returns lowercase host on success
 *   - checkProxyAllowlist non-throwing variant matches assertLoopback
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLoopback,
  checkProxyAllowlist,
  ProxyHostNotAllowedError,
  LOOPBACK_HOSTS,
} from '../../src/server/security/proxy-allowlist.ts';

test('assertLoopback: allows 127.0.0.1', () => {
  const host = assertLoopback('http://127.0.0.1:1234/v1/messages');
  assert.equal(host, '127.0.0.1');
});

test('assertLoopback: allows localhost', () => {
  const host = assertLoopback('http://localhost:1234/v1/messages');
  assert.equal(host, 'localhost');
});

test('assertLoopback: allows ::1 (IPv6 bracket form)', () => {
  const host = assertLoopback('http://[::1]:1234/v1/messages');
  assert.equal(host, '::1');
});

test('assertLoopback: rejects non-loopback (api.anthropic.com)', () => {
  assert.throws(
    () => assertLoopback('https://api.anthropic.com/v1/messages'),
    (err) => err instanceof ProxyHostNotAllowedError && err.host === 'api.anthropic.com',
  );
});

test('assertLoopback: rejects non-loopback (example.com)', () => {
  assert.throws(
    () => assertLoopback('http://example.com:8080/v1/messages'),
    (err) => err instanceof ProxyHostNotAllowedError && err.host === 'example.com',
  );
});

test('assertLoopback: invalid URL throws ProxyHostNotAllowedError', () => {
  assert.throws(
    () => assertLoopback('not-a-url'),
    (err) => err instanceof ProxyHostNotAllowedError && err.host === null,
  );
});

test('assertLoopback: empty hostname throws', () => {
  assert.throws(
    () => assertLoopback('http:///foo'),
    (err) => err instanceof ProxyHostNotAllowedError,
  );
});

test('assertLoopback: wildcard * rejected', () => {
  assert.throws(
    () => assertLoopback('http://127.0.0.1:1234/v1/messages', '*'),
    (err) => err instanceof ProxyHostNotAllowedError && err.wildcardRejected === true,
  );
});

test('assertLoopback: CSV allowlist REPLACES default loopback set', () => {
  // When MEMORY_STUDIO_PROXY_ALLOWED_HOSTS is provided, 127.0.0.1 is NOT
  // on the allowlist unless explicitly included.
  assert.throws(
    () => assertLoopback('http://127.0.0.1:1234/v1/messages', 'example.com'),
    (err) => err instanceof ProxyHostNotAllowedError,
  );
});

test('assertLoopback: CSV allowlist with example.com accepts example.com', () => {
  const host = assertLoopback('http://example.com/v1/messages', 'example.com,127.0.0.1');
  assert.equal(host, 'example.com');
});

test('assertLoopback: case-insensitive hostname comparison', () => {
  const host = assertLoopback('http://LOCALHOST:1234/v1/messages');
  assert.equal(host, 'localhost');
});

test('assertLoopback: port in URL does not affect host check', () => {
  // Various valid ports (1, 80, 443, 8080, 65535) — URL constructor
  // rejects port > 65535.
  for (const port of [1, 80, 443, 8080, 65535]) {
    const host = assertLoopback(`http://127.0.0.1:${port}/v1/messages`);
    assert.equal(host, '127.0.0.1');
  }
});

test('assertLoopback: returns lowercase host on success', () => {
  const host = assertLoopback('http://LOCALHOST:80/');
  assert.equal(host, 'localhost');
});

test('checkProxyAllowlist: non-throwing variant matches assertLoopback', () => {
  const ok = checkProxyAllowlist('http://127.0.0.1:1234/v1/messages');
  assert.equal(ok.allowed, true);
  assert.equal(ok.host, '127.0.0.1');

  const deny = checkProxyAllowlist('https://api.anthropic.com/v1/messages');
  assert.equal(deny.allowed, false);
  assert.equal(deny.host, 'api.anthropic.com');
});

test('LOOPBACK_HOSTS: contains 127.0.0.1, localhost, ::1', () => {
  assert.ok(LOOPBACK_HOSTS.has('127.0.0.1'));
  assert.ok(LOOPBACK_HOSTS.has('localhost'));
  assert.ok(LOOPBACK_HOSTS.has('::1'));
  assert.equal(LOOPBACK_HOSTS.size, 3);
});

test('assertLoopback: URL object input (not string)', () => {
  const url = new URL('http://localhost:1234/v1/messages');
  const host = assertLoopback(url);
  assert.equal(host, 'localhost');
});

test('assertLoopback: CSV whitespace stripped + empty entries skipped', () => {
  const host = assertLoopback('http://example.com:1234/v1/messages', '  example.com , , 127.0.0.1  ');
  assert.equal(host, 'example.com');
});
