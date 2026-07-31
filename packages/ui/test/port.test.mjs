import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  DEFAULT_PORT_RANGE,
  PortRangeExhaustedError,
  UI_HOST,
  findFirstFreePort,
} from '@memory-studio/ui';

async function listen(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, UI_HOST, resolve);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function findFreePair() {
  for (let first = 43_000; first < 43_999; first += 2) {
    let firstProbe;
    let secondProbe;
    try {
      firstProbe = await listen(first);
      secondProbe = await listen(first + 1);
      return first;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error;
    } finally {
      if (firstProbe) await close(firstProbe);
      if (secondProbe) await close(secondProbe);
    }
  }
  throw new Error('Could not locate two consecutive free ports for test fixture');
}

test('default scan range and host match the local UI contract', () => {
  assert.deepEqual(DEFAULT_PORT_RANGE, [41_823, 42_823]);
  assert.equal(UI_HOST, '127.0.0.1');
});

test('findFirstFreePort skips an occupied first port in ascending order', async (t) => {
  const first = await findFreePair();
  const occupied = await listen(first);
  t.after(() => close(occupied));

  const selected = await findFirstFreePort([first, first + 1]);

  assert.equal(selected, first + 1);
});

test('findFirstFreePort identifies the exhausted inclusive range', async (t) => {
  const occupied = await listen();
  t.after(() => close(occupied));
  const address = occupied.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  await assert.rejects(
    () => findFirstFreePort([address.port, address.port]),
    (error) => {
      assert.ok(error instanceof PortRangeExhaustedError);
      assert.deepEqual(error.range, [address.port, address.port]);
      assert.match(error.message, new RegExp(`${address.port}-${address.port}`));
      return true;
    },
  );
});
