export type ProviderName = 'gemini' | 'openai_compatible'
export type ProviderFailureCategory =
  | 'rate_limited' | 'upstream_500' | 'upstream_502' | 'upstream_503' | 'upstream_504'
  | 'timeout' | 'dns_failure' | 'connection_reset' | 'connection_failure' | 'fetch_failed'
  | 'invalid_request' | 'authentication_rejected' | 'permission_denied' | 'model_not_found'
  | 'malformed_output' | 'validation_failed' | 'unknown_provider_error'

export const EXTRACTION_DIAGNOSTIC_CODES = [
  'malformed_json', 'invalid_structure', 'invalid_content', 'nonretryable_provider', 'unknown_failure',
] as const
export type ExtractionDiagnosticCode = typeof EXTRACTION_DIAGNOSTIC_CODES[number]

export interface ProviderRequest { prompt: string; structured?: boolean }
export interface ProviderResponse { text: string; provider: ProviderName; model: string }
export interface ProviderAttemptMetadata { provider: ProviderName; model: string; attempts: number; retries: number; failures: string[] }
export interface ProviderResult<T> { value: T; metadata: ProviderAttemptMetadata; }
