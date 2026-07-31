import { hashSha256_16 } from './hash.ts';
import { SdkError } from './types.ts';
import type { AugmentRequest, AugmentResponse } from './types.ts';
export class MemoryStudioClient {
  private readonly baseUrl: string;
  private readonly tenantIdHashed?: string;
  constructor(opts: { baseUrl?: string; baseURL?: string; tenantId?: string }) { this.baseUrl = (opts.baseUrl ?? opts.baseURL ?? '').replace(/\/$/, ''); if (!this.baseUrl) throw new TypeError('baseUrl is required'); if (opts.tenantId !== undefined) this.tenantIdHashed = hashSha256_16(opts.tenantId); }
  async augment(req: AugmentRequest): Promise<AugmentResponse> { const body = { ...req, ...(this.tenantIdHashed === undefined ? {} : { tenantId: this.tenantIdHashed }), schemaVersion: 3 as const }; const response = await fetch(`${this.baseUrl}/augment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new SdkError('http_error', `HTTP ${response.status}: ${await response.text()}`); try { return await response.json() as AugmentResponse; } catch (error) { throw new SdkError('invalid_response', `failed to parse JSON: ${(error instanceof Error ? error.message : String(error))}`); } }
}
