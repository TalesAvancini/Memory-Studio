import {
  createUiServer,
  DEFAULT_PORT_RANGE,
} from '../packages/ui/src/index.ts';

function portRangeFromEnvironment(value) {
  if (!value) return DEFAULT_PORT_RANGE;
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid MEMORY_STUDIO_UI_PORT_RANGE: ${value}`);
  return [Number(match[1]), Number(match[2])];
}

const server = createUiServer({
  // Narrow override keeps exhaustion tests deterministic; production uses schema-v3 defaults.
  portRange: portRangeFromEnvironment(process.env.MEMORY_STUDIO_UI_PORT_RANGE),
});

try {
  const { url } = await server.start();
  console.log(`Memory Studio UI: ${url}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
