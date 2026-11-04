import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

let index: IndexFile = { docs: {}, deleted: [] }
let indexWrite = Promise.resolve()

async function loadIndex() {
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as Partial<IndexFile>
    index = { docs: parsed.docs ?? {}, deleted: parsed.deleted ?? [] }
  } catch {
    index = { docs: {}, deleted: [] }
  }
}

function saveIndex() {
  // Serialise writes so concurrent updates can't interleave.
  indexWrite = indexWrite.then(() => writeAtomic(INDEX_FILE, JSON.stringify(index, null, 2))).catch(() => undefined)
  return indexWrite
}

const isDeleted = (id: string) => index.deleted.includes(id)

/** Plain text of a Yjs document's editor content, with block boundaries kept as spaces. */
function extractText(doc: Y.Doc) {
  return doc
    .getXmlFragment('default')
    .toString()
    .replace(/<\/[^>]+>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const getTitle = (doc: Y.Doc) => {
  const title = doc.getMap('meta').get('title')
  return typeof title === 'string' ? title.trim() : ''
}

function updateIndexFromDoc(id: string, doc: Y.Doc) {
  const text = extractText(doc)
  const existing = index.docs[id]
  index.docs[id] = {
    title: getTitle(doc),
    preview: text.slice(0, 400),
    words: text ? text.split(' ').length : 0,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  return saveIndex()
}

const toMeta = (id: string): DocMeta => ({ id, ...index.docs[id] })

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
            await updateIndexFromDoc(documentName, document)
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
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Mounted at /api/docs, so paths here are "/", "/:id" or "/:id/duplicate".
    const [id, action] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    try {
      const server = await ensureServer(port)

      if (!id && req.method === 'GET') {
        const docs = Object.keys(index.docs)
          .filter((docId) => !isDeleted(docId))
          .map(toMeta)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        return send(res, 200, { docs })
      }

      if (!id && req.method === 'POST') {
        const body = await readJson(req)
        const docId = newId()
        const title = cleanTitle(body.title)
        const doc = new Y.Doc()
        if (title) doc.getMap('meta').set('title', title)
        await writeAtomic(fileFor(docId), Y.encodeStateAsUpdate(doc))
        const now = Date.now()
        index.docs[docId] = { title, preview: '', words: 0, createdAt: now, updatedAt: now }
        await saveIndex()
        return send(res, 201, toMeta(docId))
      }

      if (!id) return next()

      // Always 200, so opening a brand-new or deleted document doesn't log a failed request.
      if (action === 'status' && req.method === 'GET') {
        return send(res, 200, { deleted: isDeleted(id), exists: Boolean(index.docs[id]) })
      }

      if (isDeleted(id)) return send(res, 410, { error: 'deleted' })

      if (!action && req.method === 'GET') {
        return index.docs[id] ? send(res, 200, toMeta(id)) : send(res, 404, { error: 'not found' })
      }

      if (!action && req.method === 'PATCH') {
        if (!index.docs[id]) return send(res, 404, { error: 'not found' })
        const title = cleanTitle((await readJson(req)).title)
        await setTitle(server, id, title)
        index.docs[id] = { ...index.docs[id], title, updatedAt: Date.now() }
        await saveIndex()
        return send(res, 200, toMeta(id))
      }

      if (!action && req.method === 'DELETE') {
        if (!index.docs[id]) return send(res, 404, { error: 'not found' })
        index.deleted.push(id)
        delete index.docs[id]
        await saveIndex()
        server.hocuspocus.closeConnections(id)
        await rm(fileFor(id), { force: true })
        return send(res, 204)
      }

      if (action === 'duplicate' && req.method === 'POST') {
        if (!index.docs[id]) return send(res, 404, { error: 'not found' })
        const doc = new Y.Doc()
        const state = await currentState(server, id)
        if (state) Y.applyUpdate(doc, state)
        const sourceTitle = getTitle(doc) || extractText(doc).slice(0, 60) || 'Untitled document'
        doc.getMap('meta').set('title', `Copy of ${sourceTitle}`)
        const copyId = newId()
        await writeAtomic(fileFor(copyId), Y.encodeStateAsUpdate(doc))
        await updateIndexFromDoc(copyId, doc)
        return send(res, 201, toMeta(copyId))
      }

      return next()
    } catch (error) {
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
  httpServer?.once('close', () => server.hocuspocus.flushPendingStores())
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
