import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { collabServer } from './server/collab.ts'

const COLLAB_PORT = 1234

// Browsers connect to `ws(s)://<host>/collab`, which Vite forwards to the local
// Hocuspocus server — so collaboration works over Tailscale on the same port.
const proxy = {
  '/collab': { target: `ws://127.0.0.1:${COLLAB_PORT}`, ws: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), collabServer({ port: COLLAB_PORT })],
  server: {
    // Listen on all interfaces so the dev server is reachable over Tailscale.
    host: true,
    // Allow Tailscale MagicDNS hostnames (e.g. aldomini.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
    proxy,
  },
  preview: {
    host: true,
    allowedHosts: ['.ts.net'],
    proxy,
  },
})
