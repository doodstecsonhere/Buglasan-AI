import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { assertPublicChatReleaseConfig } from './scripts/public-chat-release-config.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  // Explicitly expose only the public key, never the server environment.
  const { SUPABASE_PUBLISHABLE_KEY } = loadEnv(mode, process.cwd(), 'SUPABASE_PUBLISHABLE_KEY')
  const publicEnv = loadEnv(mode, process.cwd(), '')
  const { VITE_DEMO_MODE } = publicEnv
  if (command === 'build' && mode === 'production') assertPublicChatReleaseConfig(publicEnv)
  // Demo fixture modules must not merely be unreachable at runtime: alias them
  // out of the production module graph so their facts and source text cannot
  // enter JavaScript chunks or source maps when live mode is selected.
  // Production is live-only by default. A deploy that omits this variable must
  // never silently fall back to demo fixtures.
  const demoModeEnabled = VITE_DEMO_MODE === 'true'
  const demoModeDisabled = !demoModeEnabled
  return {
    plugins: [react()],
    resolve: {
      alias: [
        ...(demoModeDisabled ? [
          { find: './data/demoData', replacement: fileURLToPath(new URL('./src/data/demoData.disabled.ts', import.meta.url)) },
          { find: '../data/demoData', replacement: fileURLToPath(new URL('./src/data/demoData.disabled.ts', import.meta.url)) },
          { find: './demoChatResponder', replacement: fileURLToPath(new URL('./src/services/demoChatResponder.disabled.ts', import.meta.url)) },
        ] : []),
      ],
    },
    define: {
      'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_PUBLISHABLE_KEY ?? ''),
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(demoModeEnabled ? 'true' : 'false'),
      __DEMO_BUILD__: JSON.stringify(demoModeEnabled),
    },
  }
})
