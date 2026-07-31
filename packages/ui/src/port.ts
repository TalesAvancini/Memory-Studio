import { createServer } from 'node:net';

export type PortRange = readonly [start: number, end: number];

export const DEFAULT_PORT_RANGE: PortRange = [41_823, 42_823];
export const UI_HOST = '127.0.0.1';

export class PortRangeExhaustedError extends Error {
  readonly code = 'PORT_RANGE_EXHAUSTED';
  readonly range: PortRange;
  readonly host: string;

  constructor(range: PortRange, host = UI_HOST) {
    super(`No free port in ${range[0]}-${range[1]} on ${host}`);
    this.name = 'PortRangeExhaustedError';
    this.range = range;
    this.host = host;
  }
}

function validateRange(range: PortRange): void {
  const [start, end] = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65_535 || start > end) {
    throw new RangeError(`Invalid port range: ${start}-${end}`);
  }
}

function isUnavailable(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error.code === 'EADDRINUSE' || error.code === 'EACCES');
}

async function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (isUnavailable(error)) resolve(false);
      else reject(error);
    });
    probe.listen(port, host, () => {
      probe.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

export async function findFirstFreePort(
  range: PortRange = DEFAULT_PORT_RANGE,
  host = UI_HOST,
): Promise<number> {
  validateRange(range);
  for (let port = range[0]; port <= range[1]; port += 1) {
    if (await isPortFree(port, host)) return port;
  }
  throw new PortRangeExhaustedError(range, host);
}
