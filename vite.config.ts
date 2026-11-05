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

// Third-party code goes into a few chunks by library, so they download in parallel and stay
// cached when only the app's own code changes. A group also takes the dependencies of what it
// captures, so groups run from the most shared code (React, Yjs, the editor core) to the big
// leaf libraries; otherwise e.g. the emoji group would swallow the editor core it imports.
const pkg = (names: string) => new RegExp(`node_modules[\\\\/](${names})[\\\\/]`)
const LEAF_LIBRARIES = pkg('@tiptap[\\\\/]extension-emoji|katex|@tiptap[\\\\/]extension-mathematics|highlight\\.js|lowlight')
const vendorChunks = [
  { name: 'vendor-react', test: pkg('react|react-dom|scheduler'), priority: 50 },
  // The library page uses driver.js (tours) too; keep it out of the editor chunk.
  { name: 'vendor-tours', test: pkg('driver\\.js'), priority: 45 },
  { name: 'vendor-collab', test: pkg('yjs|lib0|y-protocols|@hocuspocus'), priority: 40 },
  {
    name: 'vendor-editor',
    test: (id: string) => id.includes('node_modules') && !LEAF_LIBRARIES.test(id),
    priority: 30,
  },
  { name: 'vendor-emoji', test: pkg('@tiptap[\\\\/]extension-emoji'), priority: 20 },
  { name: 'vendor-katex', test: pkg('katex|@tiptap[\\\\/]extension-mathematics'), priority: 20 },
  { name: 'vendor-highlight', test: pkg('highlight\\.js|lowlight'), priority: 20 },
]

// https://vite.dev/config/
export default defineConfig({
  customLogger: logger,
  plugins: [react(), collabServer({ port: COLLAB_PORT })],
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: vendorChunks } },
    },
    // vendor-editor (Tiptap, ProseMirror and its extensions, ~730 kB) is the largest chunk and
    // is needed as a whole to open a document; the library page never loads it.
    chunkSizeWarningLimit: 800,
  },
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
