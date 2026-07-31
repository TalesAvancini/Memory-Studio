import { AGENT_ID } from './agent-id.ts';
import { hashSha256_16 } from './hash.ts';
import type { Fingerprint, FingerprintInput } from './types.ts';
export async function fingerprint(opts: FingerprintInput): Promise<Fingerprint> { return { projectPath: opts.projectPath, agentId: opts.agentId ?? AGENT_ID, sessionId: hashSha256_16(opts.sessionId), gitBranch: opts.gitBranch }; }
