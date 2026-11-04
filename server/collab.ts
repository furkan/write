import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
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

// Document names come from the URL (`?doc=`), so keep them filesystem-safe.
const fileFor = (documentName: string) =>
  join(DATA_DIR, `${documentName.replace(/[^\w-]/g, '_').slice(0, 100) || 'default'}.ydoc`)

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
      stopOnSignals: false,
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
  return g[globalKey]
}

export function collabServer({ port }: { port: number }): Plugin {
  return {
    name: 'write:collab-server',
    async configureServer() {
      await ensureServer(port)
    },
    async configurePreviewServer() {
      await ensureServer(port)
    },
  }
}
