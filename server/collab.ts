import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Runs a Hocuspocus (Yjs) collaboration server next to the Vite dev/preview server.
 *
 * The server only listens on 127.0.0.1; browsers reach it through Vite's `/collab`
 * WebSocket proxy, so everything — including Tailscale access — goes through one port.
 * Documents are persisted as Yjs updates in `.collab-data/`.
 */

const DATA_DIR = resolve(import.meta.dirname, '..', '.collab-data')

// Document names come from the URL (`?doc=`). Keep a readable, filesystem-safe prefix and add
// a hash of the full name so different names never share a file.
const fileFor = (documentName: string) => {
  const readable = documentName.replace(/[^\w-]/g, '_').slice(0, 60) || 'doc'
  const hash = createHash('sha256').update(documentName).digest('hex').slice(0, 12)
  return join(DATA_DIR, `${readable}-${hash}.ydoc`)
}

// Vite re-imports the config (and this module) when it restarts, so keep the
// running server on globalThis to avoid binding the port twice.
const globalKey = Symbol.for('write.collabServer')
type GlobalWithServer = typeof globalThis & { [globalKey]?: Promise<Server> }

function ensureServer(port: number): Promise<Server> {
  const g = globalThis as GlobalWithServer
  g[globalKey] ??= (async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const server = new Server({
      port,
      address: '127.0.0.1',
      quiet: true,
      // Vite owns the process signals; we flush pending stores when its server closes.
      stopOnSignals: false,
      // Persist quickly so little is lost if the dev server is stopped abruptly.
      debounce: 500,
      maxDebounce: 2000,
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            try {
              return new Uint8Array(await readFile(fileFor(documentName)))
            } catch {
              return null
            }
          },
          store: async ({ documentName, state }) => {
            await writeFile(fileFor(documentName), state)
          },
        }),
      ],
    })
    await server.listen()
    return server
  })()
  // Let a later restart retry if startup failed (e.g. the port was busy).
  g[globalKey].catch(() => {
    delete g[globalKey]
  })
  return g[globalKey]
}

async function flushOnClose(httpServer: { once(event: 'close', listener: () => void): unknown } | null, port: number) {
  const server = await ensureServer(port)
  httpServer?.once('close', () => server.hocuspocus.flushPendingStores())
}

export function collabServer({ port }: { port: number }): Plugin {
  return {
    name: 'write:collab-server',
    async configureServer(vite) {
      await flushOnClose(vite.httpServer, port)
    },
    async configurePreviewServer(preview) {
      await flushOnClose(preview.httpServer, port)
    },
  }
}
