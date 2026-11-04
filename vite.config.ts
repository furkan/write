import react from '@vitejs/plugin-react'
import { createLogger, defineConfig } from 'vite'
import { collabServer } from './server/collab.ts'

const COLLAB_PORT = 1234

// Browsers connect to `ws(s)://<host>/collab`, which Vite forwards to the local
// Hocuspocus server — so collaboration works over Tailscale on the same port.
const proxy = {
  '/collab': { target: `ws://127.0.0.1:${COLLAB_PORT}`, ws: true },
}

// A WebSocket that closes abruptly (a tab closed, a laptop sleeping, a deleted document's
// connections being dropped) makes Vite's proxy log a full stack trace. Those are expected,
// so hide them; every other error is still logged.
const EXPECTED_SOCKET_ERRORS = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED'])
const logger = createLogger()
const logError = logger.error.bind(logger)
logger.error = (message, options) => {
  const code = (options?.error as NodeJS.ErrnoException | null | undefined)?.code
  if (message.includes('ws proxy') && code && EXPECTED_SOCKET_ERRORS.has(code)) return
  logError(message, options)
}

// https://vite.dev/config/
export default defineConfig({
  customLogger: logger,
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
