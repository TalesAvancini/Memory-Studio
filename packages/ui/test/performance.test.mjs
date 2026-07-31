import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const launcherPath = fileURLToPath(new URL('../../../scripts/ui-server.mjs', import.meta.url));

async function listen(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function freePort() {
  const probe = await listen();
  const address = probe.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const port = address.port;
  await close(probe);
  return port;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolve());
      });
    } else {
      child.kill('SIGKILL');
    }
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  child.stdout.destroy();
  child.stderr.destroy();
}

function launch(projectRoot, startPort) {
  const endPort = Math.min(startPort + 10, 65_535);
  return spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', launcherPath],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        MEMORY_STUDIO_UI_PORT_RANGE: `${startPort}-${endPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function waitForUrl(child) {
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  const onStdout = (chunk) => {
    stdout += chunk;
  };
  const onStderr = (chunk) => {
    stderr += chunk;
  };
  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Launcher did not print a URL. stdout=${stdout} stderr=${stderr}`));
    }, 5_000);
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Launcher exited before URL output (${code ?? 'null'}/${signal ?? 'null'}): ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
    const check = () => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (!match) return;
      cleanup();
      resolve(match[0]);
    };
    child.stdout.on('data', check);
  });
}

async function removeProject(root) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-ui-performance-'));
  await mkdir(join(root, 'config', 'catalog'), { recursive: true });
  return root;
}

test('first-byte cold and warm requests remain below one second', async (t) => {
  const projectRoot = await projectFixture();
  const startPort = await freePort();
  const child = launch(projectRoot, startPort);
  t.after(async () => {
    await stopProcess(child);
    await removeProject(projectRoot);
  });

  const url = await waitForUrl(child);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const coldStartedAt = Date.now();
  const coldResponse = await fetch(url);
  const coldFirstByteMs = Date.now() - coldStartedAt;
  await coldResponse.text();

  const warmStartedAt = Date.now();
  const warmResponse = await fetch(url);
  const warmFirstByteMs = Date.now() - warmStartedAt;
  await warmResponse.text();

  assert.equal(coldResponse.status, 200);
  assert.equal(warmResponse.status, 200);
  assert.equal(Number.isInteger(coldFirstByteMs), true);
  assert.equal(Number.isInteger(warmFirstByteMs), true);
  assert.ok(coldFirstByteMs < 1_000, `cold first-byte was ${coldFirstByteMs}ms`);
  assert.ok(warmFirstByteMs < 1_000, `warm first-byte was ${warmFirstByteMs}ms`);

  console.log(`[PERF] ui first-byte cold=${coldFirstByteMs}ms warm=${warmFirstByteMs}ms`);
});
