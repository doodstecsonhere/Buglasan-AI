import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const publicEnv = loadEnv(mode, process.cwd(), '')
  const { VITE_CHAT_ENDPOINT } = publicEnv
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_CHAT_ENDPOINT': JSON.stringify(VITE_CHAT_ENDPOINT ?? ''),
    },
    resolve: {
      alias: {
        src: fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
