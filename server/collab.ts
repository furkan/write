import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
import * as Y from 'yjs'

/**
 * Runs a Hocuspocus (Yjs) collaboration server next to the Vite dev/preview server,
 * plus a small REST API (`/api/docs`) that backs the document library.
 *
 * The collaboration server only listens on 127.0.0.1; browsers reach it through Vite's
 * `/collab` WebSocket proxy, so everything — including Tailscale access — uses one port.
 * Documents are persisted as Yjs updates in `.collab-data/`, with an `index.json` holding
 * each document's title, preview text and timestamps.
 */

const DATA_DIR = resolve(import.meta.dirname, '..', '.collab-data')
const INDEX_FILE = join(DATA_DIR, 'index.json')

// ---------- Files ----------

// Document names come from the URL (`?doc=`). Keep a readable, filesystem-safe prefix and add
// a hash of the full name so different names never share a file.
const fileFor = (documentName: string) => {
  const readable = documentName.replace(/[^\w-]/g, '_').slice(0, 60) || 'doc'
  const hash = createHash('sha256').update(documentName).digest('hex').slice(0, 12)
  return join(DATA_DIR, `${readable}-${hash}.ydoc`)
}

async function readState(documentName: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(fileFor(documentName)))
  } catch {
    return null
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
async function writeAtomic(path: string, data: string | Uint8Array) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

// ---------- Document index ----------

export type DocMeta = {
  id: string
  title: string
  preview: string
  words: number
  createdAt: number
  updatedAt: number
}

type IndexFile = { docs: Record<string, Omit<DocMeta, 'id'>>; deleted: string[] }

// Vite re-imports this module when its config changes, but the collaboration server (and
// its store hook) lives on, so the index must be shared across module instances too.
type IndexState = {
  docs: IndexFile['docs']
  deleted: Set<string>
  loaded: boolean
  write: Promise<void>
  pending?: ReturnType<typeof setTimeout>
}
const stateKey = Symbol.for('write.docIndex')
const shared = globalThis as typeof globalThis & { [stateKey]?: IndexState }
const indexState: IndexState = (shared[stateKey] ??= {
  docs: {},
  deleted: new Set(),
  loaded: false,
  write: Promise.resolve(),
})
const { docs, deleted } = indexState

async function loadIndex() {
  if (indexState.loaded) return
  indexState.loaded = true
  // Remove temp files left by writes that were interrupted (the originals are intact).
  for (const name of await readdir(DATA_DIR)) {
    if (name.endsWith('.tmp')) await rm(join(DATA_DIR, name), { force: true })
  }
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as Partial<IndexFile>
    Object.assign(docs, parsed.docs ?? {})
    for (const id of parsed.deleted ?? []) deleted.add(id)
  } catch {
    // No index yet.
  }
}

/** Writes the index now. Writes are serialised; a failure rejects for this caller only. */
function saveIndex(): Promise<void> {
  clearTimeout(indexState.pending)
  indexState.pending = undefined
  const write = indexState.write.then(() =>
    writeAtomic(INDEX_FILE, JSON.stringify({ docs, deleted: [...deleted] } satisfies IndexFile, null, 2)),
  )
  indexState.write = write.catch(() => undefined)
  return write
}

/** Coalesces frequent index updates (document stores while people type) into one write. */
function scheduleIndexSave() {
  if (indexState.pending) return
  indexState.pending = setTimeout(() => void saveIndex().catch(() => undefined), 1000)
}

const isDeleted = (id: string) => deleted.has(id)

/**
 * Plain text of a Yjs document's editor content. Walks the Yjs tree rather than parsing
 * `toString()`, which neither escapes text nor keeps words together across marks.
 */
function extractText(doc: Y.Doc) {
  const parts: string[] = []
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta() as { insert: unknown }[]) {
          if (typeof op.insert === 'string') parts.push(op.insert)
        }
      } else if (child instanceof Y.XmlElement) {
        const label = child.getAttribute('label')
        if (child.nodeName === 'mention' && typeof label === 'string') parts.push(`@${label}`)
        walk(child)
        // Block boundaries become spaces; inline nodes (mentions, emoji, math) too.
        parts.push(' ')
      }
    }
  }
  walk(doc.getXmlFragment('default'))
  return parts.join('').replace(/\s+/g, ' ').trim()
}

const getTitle = (doc: Y.Doc) => {
  const title = doc.getMap('meta').get('title')
  return typeof title === 'string' ? title.trim() : ''
}

function updateIndexFromDoc(id: string, doc: Y.Doc) {
  const text = extractText(doc)
  const existing = docs[id]
  docs[id] = {
    title: getTitle(doc),
    preview: text.slice(0, 400),
    words: text ? text.split(' ').length : 0,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
}

const toMeta = (id: string): DocMeta => ({ id, ...docs[id] })

const newId = () => randomBytes(9).toString('base64url')

// ---------- Collaboration server ----------

// Vite re-imports the config (and this module) when it restarts, so keep the
// running server on globalThis to avoid binding the port twice.
const globalKey = Symbol.for('write.collabServer')
type GlobalWithServer = typeof globalThis & { [globalKey]?: Promise<Server> }

function ensureServer(port: number): Promise<Server> {
  const g = globalThis as GlobalWithServer
  g[globalKey] ??= (async () => {
    await mkdir(DATA_DIR, { recursive: true })
    await loadIndex()
    const server = new Server({
      port,
      address: '127.0.0.1',
      quiet: true,
      // Vite owns the process signals; we flush pending stores when its server closes.
      stopOnSignals: false,
      // Persist quickly so little is lost if the dev server is stopped abruptly.
      debounce: 500,
      maxDebounce: 2000,
      // Deleted documents stay deleted: refuse connections so an open tab can't resurrect one.
      async onConnect({ documentName }) {
        if (isDeleted(documentName)) throw new Error('Document was deleted')
      },
      extensions: [
        new Database({
          fetch: ({ documentName }) => readState(documentName),
          store: async ({ documentName, state, document }) => {
            if (isDeleted(documentName)) return
            await writeAtomic(fileFor(documentName), state)
            // A DELETE may have landed while the file was being written.
            if (isDeleted(documentName)) {
              await rm(fileFor(documentName), { force: true })
              return
            }
            updateIndexFromDoc(documentName, document)
            scheduleIndexSave()
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

// ---------- REST API ----------

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (!chunks.length) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const cleanTitle = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '')

/** Sets the title inside the live Yjs document, so open editors update immediately. */
async function setTitle(server: Server, id: string, title: string) {
  const connection = await server.hocuspocus.openDirectConnection(id)
  try {
    await connection.transact((doc) => doc.getMap('meta').set('title', title))
  } finally {
    await connection.disconnect()
  }
}

/** The current Yjs state of a document: from memory if it's open, otherwise from disk. */
async function currentState(server: Server, id: string) {
  const loaded = server.hocuspocus.documents.get(id)
  return loaded ? Y.encodeStateAsUpdate(loaded) : readState(id)
}

function createApi(port: number): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // Mounted at /api/docs, so paths here are "/", "/:id", "/:id/status" or "/:id/duplicate".
      // Decoding is inside the try: a malformed escape (e.g. %E0) must not crash the server.
      const [id, action] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const server = await ensureServer(port)

      if (!id && req.method === 'GET') {
        const list = Object.keys(docs)
          .filter((docId) => !isDeleted(docId))
          .map(toMeta)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        return send(res, 200, { docs: list })
      }

      if (!id && req.method === 'POST') {
        const body = await readJson(req)
        const docId = newId()
        const title = cleanTitle(body.title)
        const doc = new Y.Doc()
        if (title) doc.getMap('meta').set('title', title)
        await writeAtomic(fileFor(docId), Y.encodeStateAsUpdate(doc))
        const now = Date.now()
        docs[docId] = { title, preview: '', words: 0, createdAt: now, updatedAt: now }
        await saveIndex()
        return send(res, 201, toMeta(docId))
      }

      if (!id) return next()

      // Always 200, so opening a brand-new or deleted document doesn't log a failed request.
      if (action === 'status' && req.method === 'GET') {
        return send(res, 200, { deleted: isDeleted(id), exists: Boolean(docs[id]) })
      }

      if (isDeleted(id)) return send(res, 410, { error: 'deleted' })

      if (!action && req.method === 'GET') {
        return docs[id] ? send(res, 200, toMeta(id)) : send(res, 404, { error: 'not found' })
      }

      if (!action && req.method === 'PATCH') {
        const title = cleanTitle((await readJson(req)).title)
        await setTitle(server, id, title)
        // Documents opened by a raw ?doc= link may not be indexed yet; index them now.
        const state = await currentState(server, id)
        const doc = new Y.Doc()
        if (state) Y.applyUpdate(doc, state)
        updateIndexFromDoc(id, doc)
        docs[id] = { ...docs[id], title }
        await saveIndex()
        return send(res, 200, toMeta(id))
      }

      // Deletes work for any document name, indexed or not, and are permanent (tombstoned).
      if (!action && req.method === 'DELETE') {
        deleted.add(id)
        delete docs[id]
        await saveIndex()
        server.hocuspocus.closeConnections(id)
        await rm(fileFor(id), { force: true })
        return send(res, 204)
      }

      if (action === 'duplicate' && req.method === 'POST') {
        const state = await currentState(server, id)
        if (!state && !docs[id]) return send(res, 404, { error: 'not found' })
        const doc = new Y.Doc()
        if (state) Y.applyUpdate(doc, state)
        const sourceTitle = getTitle(doc) || extractText(doc).slice(0, 60) || 'Untitled document'
        doc.getMap('meta').set('title', `Copy of ${sourceTitle}`)
        const copyId = newId()
        await writeAtomic(fileFor(copyId), Y.encodeStateAsUpdate(doc))
        updateIndexFromDoc(copyId, doc)
        await saveIndex()
        return send(res, 201, toMeta(copyId))
      }

      return next()
    } catch (error) {
      if (error instanceof URIError) return send(res, 400, { error: 'bad request' })
      return send(res, 500, { error: error instanceof Error ? error.message : 'error' })
    }
  }
}

async function attach(
  middlewares: Connect.Server,
  httpServer: { once(event: 'close', listener: () => void): unknown } | null,
  port: number,
) {
  middlewares.use('/api/docs', createApi(port))
  const server = await ensureServer(port)
  httpServer?.once('close', () => {
    server.hocuspocus.flushPendingStores()
    void saveIndex().catch(() => undefined)
  })
}

export function collabServer({ port }: { port: number }): Plugin {
  return {
    name: 'write:collab-server',
    async configureServer(vite) {
      await attach(vite.middlewares, vite.httpServer, port)
    },
    async configurePreviewServer(preview) {
      await attach(preview.middlewares, preview.httpServer, port)
    },
  }
}
