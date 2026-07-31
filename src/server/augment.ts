// Phase 5a.1 T-03 stub — full POST /augment handler ships in the T-03 commit.
import type { FastifyInstance } from 'fastify';

export interface AugmentRouteOptions {
  onSuccess?: (timeMs?: number) => void;
}

export async function registerAugmentRoute(
  _app: FastifyInstance,
  _options: AugmentRouteOptions = {},
): Promise<void> {
  // Placeholder registered by boot; T-03 replaces with full handler.
}

export function recordAugmentSuccess(_timeMs: number = Date.now()): void {
  // Placeholder; T-03 wires this through boot's recordLastRequestTimestampMs.
}