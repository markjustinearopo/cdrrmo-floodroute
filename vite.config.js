import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // PORT lets tooling (e.g. the preview harness) assign a free port; the
    // default stays 5173 for the usual `npm run dev`.
    port: Number(process.env.PORT) || 5173,
    open: !process.env.PORT,
    host: '0.0.0.0',
  },
})
