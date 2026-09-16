import { normalizeSourceIngestionPayload, type SourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'

const RPC_PATH = '/rest/v1/rpc/ingest_source'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProductionIngestionStatus = 'new' | 'updated' | 'idempotent no-op'

export interface ProductionIngestionReceipt {
  readonly status: ProductionIngestionStatus
  readonly sourceId: string
  readonly postId: string
}

export class ProductionIngestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionIngestionError'
  }
}

export interface ProductionDispatcherOptions {
  readonly supabaseUrl?: string
  readonly supabaseSecretKey?: string
  readonly fetch?: typeof globalThis.fetch
}

function configuredRpcUrl(supabaseUrl: string | undefined): string {
  if (!supabaseUrl || !supabaseUrl.trim()) throw new ProductionIngestionError('SUPABASE_URL is required for production dispatch')
  let origin: URL
  try { origin = new URL(supabaseUrl) } catch { throw new ProductionIngestionError('SUPABASE_URL must be an HTTPS origin') }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new ProductionIngestionError('SUPABASE_URL must be an HTTPS origin without a path, query, fragment, or credentials')
  return new URL(RPC_PATH, origin).toString()
}

function parseAcknowledgement(value: unknown, payload: SourceIngestionPayload): ProductionIngestionReceipt {
  if (!Array.isArray(value) || value.length !== 1) throw new ProductionIngestionError('Production RPC acknowledgement must contain exactly one result')
  const acknowledgement = value[0]
  if (!acknowledgement || typeof acknowledgement !== 'object' || Array.isArray(acknowledgement)) throw new ProductionIngestionError('Production RPC acknowledgement must be an object')
  const record = acknowledgement as Record<string, unknown>
  if (Object.keys(record).length !== 4 || typeof record.source_id !== 'string' || !UUID.test(record.source_id) || record.post_id !== payload.post_id || typeof record.operation !== 'string' || typeof record.changed !== 'boolean') throw new ProductionIngestionError('Production RPC acknowledgement has an invalid shape')
  const result = record.operation === 'inserted' && record.changed ? 'new' : record.operation === 'updated' && record.changed ? 'updated' : record.operation === 'unchanged' && !record.changed ? 'idempotent no-op' : null
  if (result === null) throw new ProductionIngestionError('Production RPC acknowledgement has an invalid operation mapping')
  return { status: result, sourceId: record.source_id, postId: payload.post_id }
}

/** Node-only boundary: secrets stay in process environment and no retry is attempted. */
export async function dispatchApprovedProductionSource(input: unknown, options: ProductionDispatcherOptions = {}): Promise<ProductionIngestionReceipt> {
  const payload = normalizeSourceIngestionPayload(input)
  const secret = options.supabaseSecretKey ?? process.env.SUPABASE_SECRET_KEY
  if (!secret || !secret.trim()) throw new ProductionIngestionError('SUPABASE_SECRET_KEY is required for production dispatch')
  const rpcUrl = configuredRpcUrl(options.supabaseUrl ?? process.env.SUPABASE_URL)
  const request = options.fetch ?? globalThis.fetch
  if (typeof request !== 'function') throw new ProductionIngestionError('Production dispatch requires fetch')
  let response: Response
  try {
    response = await request(rpcUrl, { method: 'POST', headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_payload: payload }) })
  } catch {
    throw new ProductionIngestionError('Production dispatch could not reach the configured destination')
  }
  if (!response.ok) throw new ProductionIngestionError(`Production dispatch was rejected (${response.status})`)
  let acknowledgement: unknown
  try { acknowledgement = await response.json() } catch { throw new ProductionIngestionError('Production RPC acknowledgement was not JSON') }
  return parseAcknowledgement(acknowledgement, payload)
}
