import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so the dev server is reachable over Tailscale.
    host: true,
    // Allow Tailscale MagicDNS hostnames (e.g. aldomini.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
  },
  preview: {
    host: true,
    allowedHosts: ['.ts.net'],
  },
})
