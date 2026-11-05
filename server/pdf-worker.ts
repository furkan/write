import { parentPort } from 'node:worker_threads'
import { documentPage } from './pdf-html.ts'

/**
 * The PDF export's page builder, in a worker thread (server/pdf.ts): building the HTML (KaTeX,
 * syntax highlighting, the DOM) can take a while for a big document, and the server's own thread
 * also serves the collaboration sockets and the API. A build that runs past the export's deadline
 * is stopped by terminating this worker.
 *
 * Message in: `{ state: Uint8Array | null }`. Out: `{ ok: true, html, title }` or `{ ok: false, error }`.
 */

if (!parentPort) throw new Error('server/pdf-worker.ts runs as a worker thread')
const port = parentPort

port.on('message', ({ state }: { state: Uint8Array | null }) => {
  try {
    const { html, title } = documentPage(state)
    port.postMessage({ ok: true, html, title })
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  }
})
