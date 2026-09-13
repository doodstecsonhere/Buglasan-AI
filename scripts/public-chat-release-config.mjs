const PUBLIC_SUPABASE_PROJECT_REF = 'uelezensmkxfyexcwqzb'
const PUBLIC_SUPABASE_ORIGIN = `https://${PUBLIC_SUPABASE_PROJECT_REF}.supabase.co`
const PUBLIC_CHAT_ENDPOINT = `${PUBLIC_SUPABASE_ORIGIN}/functions/v1/chat`

export function resolvePublicChatEndpoint(environment) {
  const endpoint = environment.VITE_CHAT_ENDPOINT?.replace(/\/$/, '')
  if (endpoint) return endpoint

  const supabaseUrl = environment.VITE_SUPABASE_URL?.replace(/\/$/, '')
  return supabaseUrl ? `${supabaseUrl}/functions/v1/chat` : ''
}

/**
 * Release builds must carry only public browser configuration. This prevents a
 * Pages deployment from shipping a live-only UI that has no Edge Function URL.
 */
export function assertPublicChatReleaseConfig(environment) {
  const endpoint = resolvePublicChatEndpoint(environment)
  if (endpoint !== PUBLIC_CHAT_ENDPOINT) {
    throw new Error(
      `Production build requires VITE_CHAT_ENDPOINT=${PUBLIC_CHAT_ENDPOINT} or VITE_SUPABASE_URL=${PUBLIC_SUPABASE_ORIGIN}.`
    )
  }
  if (!environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() && !environment.SUPABASE_PUBLISHABLE_KEY?.trim()) {
    throw new Error('Production build requires VITE_SUPABASE_PUBLISHABLE_KEY (a public publishable key only).')
  }
  return endpoint
}

export { PUBLIC_CHAT_ENDPOINT, PUBLIC_SUPABASE_ORIGIN }
