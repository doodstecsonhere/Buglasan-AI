import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Explicitly expose only the public key, never the server environment.
  const { SUPABASE_PUBLISHABLE_KEY } = loadEnv(mode, process.cwd(), 'SUPABASE_PUBLISHABLE_KEY')
  const { VITE_DEMO_MODE } = loadEnv(mode, process.cwd(), 'VITE_DEMO_MODE')
  // Demo fixture modules must not merely be unreachable at runtime: alias them
  // out of the production module graph so their facts and source text cannot
  // enter JavaScript chunks or source maps when live mode is selected.
  const demoModeDisabled = mode === 'production' && VITE_DEMO_MODE === 'false'
  return {
    plugins: [react()],
    resolve: demoModeDisabled
      ? {
          alias: {
            './data/demoData': fileURLToPath(new URL('./src/data/demoData.disabled.ts', import.meta.url)),
            '../data/demoData': fileURLToPath(new URL('./src/data/demoData.disabled.ts', import.meta.url)),
          },
        }
      : undefined,
    define: {
      'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_PUBLISHABLE_KEY ?? ''),
    },
  }
})
