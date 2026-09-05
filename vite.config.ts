import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Explicitly expose only the public key, never the server environment.
  const { SUPABASE_PUBLISHABLE_KEY } = loadEnv(mode, process.cwd(), 'SUPABASE_PUBLISHABLE_KEY')
  return {
    plugins: [react()],
    define: {
      'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_PUBLISHABLE_KEY ?? ''),
    },
  }
})
