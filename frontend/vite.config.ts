import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    headers: {
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co https://mdukduvdzwxfheyqvkfy.supabase.co data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: wss: https://*.supabase.co https://mdukduvdzwxfheyqvkfy.supabase.co;",
    },
  },
})
