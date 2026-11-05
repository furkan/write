import react from '@vitejs/plugin-react'
import { createLogger, defineConfig, loadEnv } from 'vite'
import { collabServer } from './server/collab.ts'
import { resolveConfig } from './server/config.ts'

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
export default defineConfig(({ command, mode, isPreview }) => {
  // `vite dev` is Dev mode and `vite preview` is Access mode (ADR 0002). `vite build` starts no
  // server, so it never needs the Access settings. WRITE_* variables come from the environment
  // (the pilot's systemd EnvironmentFile=) or from .env files; see .env.example.
  const env = { ...loadEnv(mode, import.meta.dirname, 'WRITE_'), ...process.env }
  const config = command === 'serve' ? resolveConfig(isPreview ? 'access' : 'dev', env, import.meta.dirname) : null

  // Dev listens on all interfaces by default so it is reachable over Tailscale; preview (the
  // pilot) on loopback only, so nothing can reach it without going through Access.
  const listen = config
    ? {
        host: config.host,
        port: config.port,
        // Fail instead of quietly moving to the next port: the pilot and the dev server may share a machine.
        strictPort: true,
        // Tailscale MagicDNS hostnames (e.g. aldomini.<tailnet>.ts.net), plus e.g. the pilot's Access hostname.
        allowedHosts: ['.ts.net', ...config.allowedHosts],
        // Browsers connect to `ws(s)://<host>/collab`, which Vite forwards to the local Hocuspocus
        // server, so collaboration uses the app's port. The proxy keeps the browser's Host,
        // Origin, cookies and Access JWT, which the collaboration server checks itself.
        proxy: { '/collab': { target: `ws://127.0.0.1:${config.collabPort}`, ws: true } },
      }
    : undefined

  return {
    customLogger: logger,
    plugins: [react(), config && collabServer(config)],
    build: {
      rolldownOptions: {
        output: { codeSplitting: { groups: vendorChunks } },
      },
      // vendor-editor (Tiptap, ProseMirror and its extensions, ~730 kB) is the largest chunk and
      // is needed as a whole to open a document; the library page never loads it.
      chunkSizeWarningLimit: 800,
    },
    server: listen,
    preview: listen,
  }
})
