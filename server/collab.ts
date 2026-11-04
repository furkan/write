import { Database } from '@hocuspocus/extension-database'
import { Server } from '@hocuspocus/server'
import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'
import * as Y from 'yjs'
import { audit } from './audit.ts'
import {
  createAuthenticator,
  fetchHeaders,
  identifyRequest,
  nodeHeaders,
  type Authenticator,
  type HeaderGetter,
  type Identity,
  type User,
} from './auth.ts'
import { describeConfig, type WriteConfig } from './config.ts'

/**
 * Runs a Hocuspocus (Yjs) collaboration server next to the Vite dev/preview server,
 * plus a small REST API (`/api/docs`) that backs the document library.
 *
 * The collaboration server only listens on 127.0.0.1; browsers reach it through Vite's
 * `/collab` WebSocket proxy, so everything — including Tailscale access — uses one port.
 * Documents are persisted as Yjs updates in the data dir (`WRITE_DATA_DIR`, default
 * `.collab-data/`), with an `index.json` holding each document's title, preview text and timestamps.
 *
 * Every `/api/*` request and every collaboration connection is identified first (see
 * `server/auth.ts`): Access mode verifies the Cloudflare Access JWT, Dev mode trusts a cookie.
 *
 * Deleting a document moves it to the Trash, where it can be restored for 30 days. A daily
 * snapshot of the data dir is copied to the backup dir (`WRITE_BACKUP_DIR`, default `.collab-backups/`).
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Documents in the Trash are deleted forever after this long. */
const TRASH_RETENTION_MS = 30 * DAY
const BACKUP_INTERVAL_MS = DAY
const BACKUPS_TO_KEEP = 14

// ---------- Files ----------

// Document names come from the URL (`?doc=`). Keep a readable, filesystem-safe prefix and add
// a hash of the full name so different names never share a file.
const fileFor = (documentName: string) => {
  const readable = documentName.replace(/[^\w-]/g, '_').slice(0, 60) || 'doc'
  const hash = createHash('sha256').update(documentName).digest('hex').slice(0, 12)
  return join(dirs().data, `${readable}-${hash}.ydoc`)
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
  /** Set while the document is in the Trash. */
  trashedAt?: number
}

type IndexFile = { docs: Record<string, Omit<DocMeta, 'id'>>; deleted: string[] }

// Vite re-imports this module when its config changes, but the collaboration server (and
// its store hook) lives on, so the index must be shared across module instances too.
type IndexState = {
  /** Set from the plugin options when the collaboration server starts. */
  dirs?: { data: string; backups: string }
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

function dirs() {
  if (!indexState.dirs) throw new Error('The collaboration server has not started yet')
  return indexState.dirs
}

const indexFile = () => join(dirs().data, 'index.json')

async function loadIndex() {
  if (indexState.loaded) return
  indexState.loaded = true
  // Remove temp files left by writes that were interrupted (the originals are intact).
  for (const name of await readdir(dirs().data)) {
    if (name.endsWith('.tmp')) await rm(join(dirs().data, name), { force: true })
  }
  try {
    const parsed = JSON.parse(await readFile(indexFile(), 'utf8')) as Partial<IndexFile>
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
    writeAtomic(indexFile(), JSON.stringify({ docs, deleted: [...deleted] } satisfies IndexFile, null, 2)),
  )
  indexState.write = write.catch(() => undefined)
  return write
}

/** Coalesces frequent index updates (document stores while people type) into one write. */
function scheduleIndexSave() {
  if (indexState.pending) return
  indexState.pending = setTimeout(() => void saveIndex().catch(() => undefined), 1000)
}

/** Deleted forever (tombstoned). */
const isDeleted = (id: string) => deleted.has(id)
const isTrashed = (id: string) => docs[id]?.trashedAt !== undefined
/** Trashed and deleted documents can't be opened or synced. */
const isClosed = (id: string) => isDeleted(id) || isTrashed(id)

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
  // Spread the existing entry so other fields (e.g. trashedAt) survive.
  docs[id] = {
    ...existing,
    title: getTitle(doc),
    preview: text.slice(0, 400),
    words: text ? text.split(' ').length : 0,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
}

const toMeta = (id: string): DocMeta => ({ id, ...docs[id] })

const toTrashed = (id: string) => {
  const meta = toMeta(id)
  return { ...meta, purgeAt: (meta.trashedAt ?? 0) + TRASH_RETENTION_MS }
}

const newId = () => randomBytes(9).toString('base64url')

// ---------- Collaboration server ----------

/** What Hocuspocus hooks see as `context` once a connection is authenticated. */
export type CollabContext = { user: User }

/** The running collaboration server and the configuration it was started with. */
type Runtime = {
  server: Server<CollabContext>
  config: WriteConfig
  authenticator: Authenticator
}

/**
 * Rejects a collaboration connection. Not an `Error`: Hocuspocus logs the stack of any hook
 * error that has a message, and auth failures are already in the audit log. `reason` is what
 * the provider's `onAuthenticationFailed` receives.
 */
class CollabRejection {
  readonly reason: string
  constructor(reason: 'unauthenticated' | 'permission-denied') {
    this.reason = reason
  }
}

/** Where a request came from, for the audit log (Cloudflare's header when behind the tunnel). */
const clientIp = (header: HeaderGetter, socketAddress?: string) =>
  header('cf-connecting-ip') ?? socketAddress ?? null

function logAuthFailure(identity: Extract<Identity, { ok: false }>, fields: Record<string, unknown>) {
  audit('auth_fail', { status: identity.status, reason: identity.reason, ...identity.detail, ...fields })
}

/** Starts listening, turning "port in use" into an error that says what to do. */
function listen(server: Server<CollabContext>, port: number) {
  return new Promise<void>((resolve, reject) => {
    // Hocuspocus's own listen() never rejects; a busy port only emits `error` on its HTTP server.
    const onError = (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `[write] The collaboration port 127.0.0.1:${port} is already in use (is another Write ` +
                `server running?). Stop it, or set WRITE_COLLAB_PORT to a free port.`,
            )
          : error,
      )
    }
    server.httpServer.once('error', onError)
    server.listen().then(() => {
      server.httpServer.off('error', onError)
      resolve()
    }, reject)
  })
}

async function startRuntime(config: WriteConfig): Promise<Runtime> {
  indexState.dirs = { data: config.dataDir, backups: config.backupDir }
  await mkdir(config.dataDir, { recursive: true })
  await loadIndex()
  const authenticator = createAuthenticator(config.auth)
  const server = new Server<CollabContext>({
    port: config.collabPort,
    address: '127.0.0.1',
    quiet: true,
    // Vite owns the process signals; we flush pending stores when its server closes.
    stopOnSignals: false,
    // Persist quickly so little is lost if the dev server is stopped abruptly.
    debounce: 500,
    maxDebounce: 2000,
    // Runs for every document on every socket, before anything syncs. The provider always sends
    // an auth message (an empty token when none is set), so no token is needed on the client: the
    // identity comes from the upgrade request's headers, which Vite's proxy passes through. This
    // check runs here, not in the proxy, because anything on this machine can reach 127.0.0.1.
    async onAuthenticate({ requestHeaders, documentName }) {
      const header = fetchHeaders(requestHeaders)
      const identity = await identifyRequest(authenticator, header, {
        checkOrigin: true,
        allowedOrigins: config.allowedOrigins,
      })
      if (!identity.ok) {
        logAuthFailure(identity, { via: 'collab', doc: documentName, ip: clientIp(header) })
        throw new CollabRejection(identity.status === 403 ? 'permission-denied' : 'unauthenticated')
      }
      // Trashed and deleted documents are closed: refuse connections so an open tab can't
      // keep editing (or resurrect) one.
      if (isClosed(documentName)) throw new Error('Document is in the trash or was deleted')
      return { user: identity.user } satisfies CollabContext
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
  await listen(server, config.collabPort)
  startMaintenance(server)
  return { server, config, authenticator }
}

// Vite re-imports the config (and this module) when it restarts, so keep the
// running server on globalThis to avoid binding the port twice.
const globalKey = Symbol.for('write.collabServer')
type GlobalWithServer = typeof globalThis & {
  [globalKey]?: { configJson: string; runtime: Promise<Runtime> }
}

function ensureRuntime(config: WriteConfig): Promise<Runtime> {
  const g = globalThis as GlobalWithServer
  const configJson = JSON.stringify(config)
  const running = g[globalKey]
  if (running) {
    // The running server keeps its data dir, ports and auth settings until the process restarts.
    if (running.configJson !== configJson) {
      console.warn('[write] WRITE_* settings changed; restart the server to apply them.')
    }
    return running.runtime
  }
  const runtime = startRuntime(config)
  g[globalKey] = { configJson, runtime }
  // Let a later restart retry if startup failed (e.g. the port was busy).
  runtime.catch(() => {
    delete g[globalKey]
  })
  return runtime
}

// ---------- Trash ----------

/** The current Yjs state of a document: from memory if it's open, otherwise from disk. */
async function currentState(server: Server, id: string) {
  const loaded = server.hocuspocus.documents.get(id)
  return loaded ? Y.encodeStateAsUpdate(loaded) : readState(id)
}

/** Returns false if there is no such document. */
async function moveToTrash(server: Server, id: string) {
  if (isTrashed(id)) return true
  // Documents opened by a raw ?doc= link may not be indexed yet; index them so they show in the Trash.
  if (!docs[id]) {
    const state = await currentState(server, id)
    if (!state) return false
    const doc = new Y.Doc()
    Y.applyUpdate(doc, state)
    updateIndexFromDoc(id, doc)
  }
  docs[id] = { ...docs[id], trashedAt: Date.now() }
  await saveIndex()
  // Open tabs get disconnected; their reconnects are refused and they show a "moved to trash" banner.
  // Hocuspocus stores the latest state as the document unloads, so nothing typed is lost.
  server.hocuspocus.closeConnections(id)
  return true
}

async function restoreFromTrash(id: string) {
  docs[id] = { ...docs[id], trashedAt: undefined }
  await saveIndex()
}

/**
 * Deletes documents forever; their IDs are tombstoned so they can never be synced again.
 * Only IDs still in the Trash are purged, and that check and the index change happen
 * synchronously, so a document restored a moment earlier is never caught. Returns the purged IDs.
 */
async function purge(server: Server, ids: string[]) {
  const purged = ids.filter(isTrashed)
  if (!purged.length) return purged
  for (const id of purged) {
    deleted.add(id)
    delete docs[id]
  }
  await saveIndex()
  for (const id of purged) server.hocuspocus.closeConnections(id)
  await Promise.all(purged.map((id) => rm(fileFor(id), { force: true })))
  return purged
}

const trashedIds = () => Object.keys(docs).filter(isTrashed)

function purgeExpired(server: Server) {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const expired = trashedIds().filter((id) => (docs[id].trashedAt ?? Infinity) <= cutoff)
  return purge(server, expired)
}

// ---------- Backups ----------

// Snapshot folders are named by UTC time, so they sort chronologically.
const SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/

async function listSnapshots() {
  try {
    return (await readdir(dirs().backups)).filter((name) => SNAPSHOT_NAME.test(name)).sort()
  } catch {
    return []
  }
}

/** Copies the data dir into a new timestamped folder and keeps the newest few. */
async function backup() {
  const { data, backups } = dirs()
  await mkdir(backups, { recursive: true })
  // Remove copies left incomplete by a failed or interrupted backup.
  for (const name of await readdir(backups)) {
    if (name.endsWith('.partial')) await rm(join(backups, name), { recursive: true, force: true })
  }
  // Let any index write in progress finish; document files are written atomically.
  await indexState.write
  const name = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  const partial = join(backups, `${name}.partial`)
  try {
    await cp(data, partial, { recursive: true, filter: (src) => !src.endsWith('.tmp') })
  } catch (error) {
    // e.g. a document deleted forever mid-copy; the next hourly check tries again.
    await rm(partial, { recursive: true, force: true })
    throw error
  }
  // Only complete copies get a snapshot name.
  await rename(partial, join(backups, name))
  const snapshots = await listSnapshots()
  for (const old of snapshots.slice(0, -BACKUPS_TO_KEEP)) {
    await rm(join(backups, old), { recursive: true, force: true })
  }
}

/** Snapshot time from a folder name like 2026-11-05T09-30-00Z. */
const snapshotTime = (name: string) =>
  Date.parse(name.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z'))

async function backupIfDue() {
  const latest = (await listSnapshots()).at(-1)
  if (latest && Date.now() - snapshotTime(latest) < BACKUP_INTERVAL_MS) return
  await backup()
}

/** Hourly: delete expired Trash items and take a backup when the last one is a day old. */
function startMaintenance(server: Server) {
  const run = async () => {
    try {
      await backupIfDue()
    } catch (error) {
      console.error('[write] backup failed:', error)
    }
    try {
      await purgeExpired(server)
    } catch (error) {
      console.error('[write] emptying expired trash failed:', error)
    }
  }
  void run()
  setInterval(() => void run(), HOUR).unref()
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

// ---------- Identity ----------

/** The user of each `/api/*` request, set by `identify()` before any handler runs. */
const requestUsers = new WeakMap<IncomingMessage, User>()

/**
 * Runs first for every `/api/*` request: the Origin check for anything but GET and HEAD,
 * then the caller's identity. Without one the request ends here with 401 (or 403 for a
 * foreign origin or a token without an email).
 */
const identify =
  ({ authenticator, config }: Runtime): Connect.NextHandleFunction =>
  async (req, res, next) => {
    const header = nodeHeaders(req.headers)
    let identity: Identity
    try {
      identity = await identifyRequest(authenticator, header, {
        checkOrigin: req.method !== 'GET' && req.method !== 'HEAD',
        allowedOrigins: config.allowedOrigins,
      })
    } catch (error) {
      console.error('[write] identifying a request failed:', error)
      return send(res, 500, { error: 'error' })
    }
    if (!identity.ok) {
      logAuthFailure(identity, {
        via: 'api',
        method: req.method,
        path: req.originalUrl ?? req.url,
        ip: clientIp(header, req.socket.remoteAddress),
      })
      const error = { 401: 'unauthenticated', 403: 'forbidden', 503: 'unavailable' }[identity.status]
      return send(res, identity.status, { error })
    }
    requestUsers.set(req, identity.user)
    next()
  }

/** `GET /api/me`: who the server thinks the caller is. */
const meApi =
  ({ config }: Runtime): Connect.NextHandleFunction =>
  (req, res, next) => {
    if (req.method !== 'GET' || new URL(req.url ?? '/', 'http://localhost').pathname !== '/') return next()
    const user = requestUsers.get(req)
    if (!user) return send(res, 401, { error: 'unauthenticated' })
    return send(res, 200, { email: user.email, mode: config.auth.mode })
  }

// ---------- REST API handlers ----------

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
  route: { id?: string; action?: string; server: Server<CollabContext>; user: User },
) => Promise<void>

/**
 * Parses `/:id/:action`, passes the caller (`user`) and handles errors. A malformed escape
 * (e.g. %E0) must not crash the server.
 */
function route({ server }: Runtime, handler: Handler): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // `identify()` runs first, so this only fails if the middleware order is broken.
    const user = requestUsers.get(req)
    if (!user) return send(res, 401, { error: 'unauthenticated' })
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const [id, action] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      await handler(req, res, next, { id, action, server, user })
    } catch (error) {
      // Malformed escapes in the URL or malformed JSON bodies.
      if (error instanceof URIError || error instanceof SyntaxError) return send(res, 400, { error: 'bad request' })
      return send(res, 500, { error: error instanceof Error ? error.message : 'error' })
    }
  }
}

/** `/api/trash`: list, restore, delete forever, empty. */
const trashApi = (runtime: Runtime) =>
  route(runtime, async (req, res, next, { id, action, server }) => {
    if (!id && req.method === 'GET') {
      const list = trashedIds()
        .map(toTrashed)
        .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
      return send(res, 200, { docs: list, retentionDays: TRASH_RETENTION_MS / DAY })
    }

    // Empties the Trash as the caller saw it: only the IDs listed, so documents someone else
    // trashed in the meantime are not deleted unseen.
    if (!id && req.method === 'DELETE') {
      const { ids } = await readJson(req)
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
        return send(res, 400, { error: 'expected { ids: string[] }' })
      }
      const purged = await purge(server, ids)
      return send(res, 200, { purged: purged.length })
    }

    if (!id) return next()
    // Only documents in the Trash can be restored or deleted forever.
    if (!isTrashed(id)) return send(res, 404, { error: 'not in trash' })

    if (action === 'restore' && req.method === 'POST') {
      await restoreFromTrash(id)
      return send(res, 200, toMeta(id))
    }

    if (!action && req.method === 'DELETE') {
      await purge(server, [id])
      return send(res, 204)
    }

    return next()
  })

/** `/api/docs`: the document library. */
const docsApi = (runtime: Runtime) =>
  route(runtime, async (req, res, next, { id, action, server }) => {
    if (!id && req.method === 'GET') {
      const list = Object.keys(docs)
        .filter((docId) => !isClosed(docId))
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
      return send(res, 200, { deleted: isDeleted(id), trashed: isTrashed(id), exists: Boolean(docs[id]) })
    }

    if (isDeleted(id)) return send(res, 410, { error: 'deleted' })

    // Moves the document to the Trash. Works for any existing document, indexed or not.
    if (!action && req.method === 'DELETE') {
      return (await moveToTrash(server, id)) ? send(res, 204) : send(res, 404, { error: 'not found' })
    }

    if (isTrashed(id)) return send(res, 410, { error: 'trashed' })

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
  })

async function attach(
  middlewares: Connect.Server,
  httpServer: { once(event: 'close', listener: () => void): unknown } | null,
  config: WriteConfig,
) {
  const runtime = await ensureRuntime(config)
  console.log(describeConfig(runtime.config))
  // Identity first: nothing under /api is served without one.
  middlewares.use('/api', identify(runtime))
  middlewares.use('/api/me', meApi(runtime))
  middlewares.use('/api/docs', docsApi(runtime))
  middlewares.use('/api/trash', trashApi(runtime))
  // Unknown API paths get a JSON 404, not the app's index.html.
  middlewares.use('/api', (_req, res) => send(res, 404, { error: 'not found' }))
  httpServer?.once('close', () => {
    runtime.server.hocuspocus.flushPendingStores()
    void saveIndex().catch(() => undefined)
  })
}

/** The Vite plugin. `config` comes from `resolveConfig()` in `vite.config.ts`. */
export function collabServer(config: WriteConfig): Plugin {
  return {
    name: 'write:collab-server',
    async configureServer(vite) {
      await attach(vite.middlewares, vite.httpServer, config)
    },
    async configurePreviewServer(preview) {
      await attach(preview.middlewares, preview.httpServer, config)
    },
  }
}
