# @memory-studio/sdk

## Installation

```bash
npm install @memory-studio/sdk
```

## Basic Usage

```ts
import { collectContext, fingerprint, MemoryStudioClient } from '@memory-studio/sdk';

const context = await collectContext({ scratch, todos, recentFiles, lastEvent });
const fp = await fingerprint({ projectPath, sessionId, gitBranch });
const client = new MemoryStudioClient({ baseUrl: 'http://localhost:41823', tenantId: 'tenant-abc' });
const response = await client.augment({ prompt, context, fingerprint: fp, activeCatalog: [], schemaVersion: 3 });
```

## API Reference

See [PRD §5](../../PRD.md#5-sdk-cliente) for the full contract and response shape.

## Notes

This is a workspace package for the Memory Studio client SDK. The MVP supports Claude Code only, uses prompt-only mode with `context: null`, and has zero runtime dependencies.
