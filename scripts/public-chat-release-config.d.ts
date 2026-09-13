export const PUBLIC_CHAT_ENDPOINT: string
export const PUBLIC_SUPABASE_ORIGIN: string
export function resolvePublicChatEndpoint(environment: Record<string, string | undefined>): string
export function assertPublicChatReleaseConfig(environment: Record<string, string | undefined>): string
