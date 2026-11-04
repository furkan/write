import { Database } from '@hocuspocus/extension-database'
import { Server, type Connection } from '@hocuspocus/server'
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
  normalizeEmail,
  type Authenticator,
  type HeaderGetter,
  type Identity,
  type User,
} from './auth.ts'
import { describeConfig, type WriteConfig } from './config.ts'
import {
  canEdit,
  isShareRole,
  isValidEmail,
  MAX_SHARES,
  roleOf,
  sanitizeShares,
  shareOf,
  statusFor,
  type Role,
  type Shares,
} from './roles.ts'

/**
 * Runs a Hocuspocus (Yjs) collaboration server next to the Vite dev/preview server,
 * plus a small REST API (`/api/docs`) that backs the document library.
 *
 * The collaboration server only listens on 127.0.0.1; browsers reach it through Vite's
 * `/collab` WebSocket proxy, so everything — including Tailscale access — uses one port.
 * Documents are persisted as Yjs updates in the data dir (`WRITE_DATA_DIR`, default
 * `.collab-data/`), with an `index.json` holding each document's title, preview text, timestamps,
 * Owner and Shares.
 *
 * Every `/api/*` request and every collaboration connection is identified first (see
 * `server/auth.ts`): Access mode verifies the Cloudflare Access JWT, Dev mode trusts a cookie.
 * Then the caller's role on the document is resolved (`server/roles.ts`): No access is a 404 or
 * `permission-denied`, and a viewer's collaboration connection is read-only.
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
export const docFileName = (documentName: string) => {
  const readable = documentName.replace(/[^\w-]/g, '_').slice(0, 60) || 'doc'
  const hash = createHash('sha256').update(documentName).digest('hex').slice(0, 12)
  return `${readable}-${hash}.ydoc`
}

const fileFor = (documentName: string) => join(dirs().data, docFileName(documentName))

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

/** One document in `index.json` (version 2): its library metadata, Owner and Shares. */
type IndexEntry = {
  title: string
  preview: string
  words: number
  createdAt: number
  updatedAt: number
  /** Set while the document is in the Trash. */
  trashedAt?: number
  owner: string
  shares: Shares
}

/** A library item as the API returns it. `shares` is only included for the owner (and in `GET /:id`). */
export type DocMeta = Omit<IndexEntry, 'owner' | 'shares'> & {
  id: string
  owner: string
  /** The caller's role. */
  role: Role
  shares?: Shares
}

const INDEX_VERSION = 2

type IndexFile = {
  version: typeof INDEX_VERSION
  docs: Record<string, IndexEntry>
  /** Tombstones: each purged ID with the email of its former owner. */
  deleted: Record<string, string>
}

// Vite re-imports this module when its config changes, but the collaboration server (and
// its store hook) lives on, so the index must be shared across module instances too.
// (`v2`: an older module's state has a different shape, so a server started before
// ownership existed is never reused; restart the process after upgrading.)
type IndexState = {
  /** Set from the plugin options when the collaboration server starts. */
  dirs?: { data: string; backups: string }
  /** Null-prototype, so IDs like `constructor` never match a built-in property. */
  docs: Record<string, IndexEntry>
  /** Tombstones: purged ID → former owner. */
  deleted: Map<string, string>
  loaded: boolean
  write: Promise<void>
  pending?: ReturnType<typeof setTimeout>
}
const stateKey = Symbol.for('write.docIndex.v2')
const shared = globalThis as typeof globalThis & { [stateKey]?: IndexState }
const indexState: IndexState = (shared[stateKey] ??= {
  docs: Object.create(null) as Record<string, IndexEntry>,
  deleted: new Map(),
  loaded: false,
  write: Promise.resolve(),
})
const { docs, deleted } = indexState

function dirs() {
  if (!indexState.dirs) throw new Error('The collaboration server has not started yet')
  return indexState.dirs
}

const indexFile = () => join(dirs().data, 'index.json')

/** The index entry for an ID, if the document exists (open or trashed). */
const entryOf = (id: string): IndexEntry | undefined => docs[id]

type RawIndex = {
  version?: unknown
  docs?: Record<string, Partial<IndexEntry> & Record<string, unknown>>
  deleted?: unknown
}

async function readIndexFile(): Promise<RawIndex | null> {
  let text: string
  try {
    text = await readFile(indexFile(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') return parsed as RawIndex
  } catch {
    // reported below
  }
  // Starting with an empty index would overwrite it and lose every document's owner and shares.
  throw new Error(`[write] ${indexFile()} is not valid JSON. Fix or restore it from a backup, then restart.`)
}

/**
 * Loads `index.json`, migrating a version-1 index (from before ownership) once: a forced backup
 * snapshot first, then every entry without an owner goes to the Legacy owner (`WRITE_OWNER_EMAIL`)
 * and the file is rewritten as version 2. Throws, so the server refuses to start, when ownerless
 * documents exist and no Legacy owner is configured (Access mode without `WRITE_OWNER_EMAIL`).
 * `.ydoc` files with no index entry stay on disk and are never served.
 */
async function loadIndex(config: WriteConfig) {
  if (indexState.loaded) return
  // Remove temp files left by writes that were interrupted (the originals are intact).
  for (const name of await readdir(dirs().data)) {
    if (name.endsWith('.tmp')) await rm(join(dirs().data, name), { force: true })
  }
  const raw = await readIndexFile()
  if (!raw) {
    indexState.loaded = true
    return
  }

  const rawDocs = raw.docs && typeof raw.docs === 'object' ? raw.docs : {}
  const ownerless = Object.keys(rawDocs).filter((id) => !normalizeEmail(rawDocs[id]?.owner))
  const legacyOwner = config.ownerEmail
  if (ownerless.length && (!legacyOwner || !isValidEmail(legacyOwner))) {
    throw new Error(
      `[write] ${indexFile()} has ${ownerless.length} document(s) without an owner (from before per-user ` +
        `access). Set WRITE_OWNER_EMAIL to the email that should own them, then restart.` +
        (legacyOwner ? ` "${legacyOwner}" is not an email.` : ''),
    )
  }
  const migrating = raw.version !== INDEX_VERSION || ownerless.length > 0
  // Before changing anything, keep a copy of the data exactly as it was.
  const snapshot = migrating ? await backup() : undefined

  for (const [id, value] of Object.entries(rawDocs)) {
    if (!value || typeof value !== 'object') continue
    const owner = normalizeEmail(value.owner) || (legacyOwner as string)
    docs[id] = {
      ...(value as IndexEntry),
      owner,
      shares: sanitizeShares(value.shares, owner),
    }
  }
  // Version 1 kept tombstones as a list of IDs, with no owner.
  if (Array.isArray(raw.deleted)) {
    for (const id of raw.deleted) if (typeof id === 'string') deleted.set(id, legacyOwner ?? '')
  } else if (raw.deleted && typeof raw.deleted === 'object') {
    for (const [id, owner] of Object.entries(raw.deleted)) deleted.set(id, normalizeEmail(owner))
  }
  indexState.loaded = true

  if (migrating) {
    await saveIndex()
    audit('migration', {
      from: typeof raw.version === 'number' ? raw.version : 1,
      to: INDEX_VERSION,
      owner: ownerless.length ? legacyOwner : null,
      assigned: ownerless.length,
      docs: Object.keys(docs).length,
      tombstones: deleted.size,
      backup: snapshot,
    })
  }
}

/** Writes the index now. Writes are serialised; a failure rejects for this caller only. */
function saveIndex(): Promise<void> {
  clearTimeout(indexState.pending)
  indexState.pending = undefined
  const write = indexState.write.then(() => {
    const file: IndexFile = { version: INDEX_VERSION, docs, deleted: Object.fromEntries(deleted) }
    return writeAtomic(indexFile(), JSON.stringify(file, null, 2))
  })
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
const isTrashed = (id: string) => entryOf(id)?.trashedAt !== undefined

/** The caller's role on a document they can open now (not trashed or deleted), or null for No access. */
const roleFor = (id: string, user: User) => roleOf(entryOf(id), user.email)

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

/** Refreshes an indexed document's title, preview and edit time. Never creates an entry. */
function updateIndexFromDoc(id: string, doc: Y.Doc) {
  const existing = entryOf(id)
  if (!existing) return
  const text = extractText(doc)
  // Spread the existing entry so other fields (owner, shares, trashedAt) survive.
  docs[id] = {
    ...existing,
    title: getTitle(doc),
    preview: text.slice(0, 400),
    words: text ? text.split(' ').length : 0,
    updatedAt: Date.now(),
  }
}

/** Adds a new document to the index, owned by `owner`, with no shares. */
function addEntry(id: string, owner: string, doc: Y.Doc) {
  const now = Date.now()
  docs[id] = { title: '', preview: '', words: 0, createdAt: now, updatedAt: now, owner, shares: {} }
  updateIndexFromDoc(id, doc)
}

/**
 * A document as someone with `role` sees it. Shares are listed for the owner, or for anyone
 * when `withShares` is set (`GET /:id`: everyone with access sees who has access).
 */
function toMeta(id: string, role: Role, { withShares = false } = {}): DocMeta {
  const { shares, ...entry } = docs[id]
  return { id, ...entry, role, ...(withShares || role === 'owner' ? { shares: { ...shares } } : {}) }
}

const toTrashed = (id: string) => {
  const meta = toMeta(id, 'owner')
  return { ...meta, purgeAt: (meta.trashedAt ?? 0) + TRASH_RETENTION_MS }
}

const newId = () => randomBytes(9).toString('base64url')

// ---------- Collaboration server ----------

/** What Hocuspocus hooks see as `context` once a connection is authenticated. */
export type CollabContext = { user: User; role: Role }

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
  await loadIndex(config)
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
    async onAuthenticate({ requestHeaders, documentName, connectionConfig }) {
      const header = fetchHeaders(requestHeaders)
      const identity = await identifyRequest(authenticator, header, {
        checkOrigin: true,
        allowedOrigins: config.allowedOrigins,
      })
      if (!identity.ok) {
        logAuthFailure(identity, { via: 'collab', doc: documentName, ip: clientIp(header) })
        throw new CollabRejection(identity.status === 403 ? 'permission-denied' : 'unauthenticated')
      }
      // No access looks the same whether the document never existed (only `POST /api/docs`
      // creates documents, so a `?doc=` name can't), is someone else's, is in the Trash or
      // was deleted forever.
      const role = roleFor(documentName, identity.user)
      if (!role) throw new CollabRejection('permission-denied')
      // The server drops a viewer's updates (and answers them with "not synced").
      if (role === 'viewer') connectionConfig.readOnly = true
      return { user: identity.user, role } satisfies CollabContext
    },
    // Access may have changed while this connection was being set up (after onAuthenticate,
    // before it was registered, so `closeConnections` missed it): check once more.
    async connected({ documentName, context, connection }) {
      if (roleFor(documentName, context.user) !== context.role) resetConnection(connection)
    },
    extensions: [
      new Database({
        fetch: ({ documentName }) => readState(documentName),
        store: async ({ documentName, state, document }) => {
          // Only indexed documents are stored, so nothing can bring back a purged one.
          if (isDeleted(documentName) || !entryOf(documentName)) return
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
const globalKey = Symbol.for('write.collabServer.v2')
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

/** WebSocket close code for "access changed, reconnect" (Hocuspocus's own "Reset Connection"). */
const RESET_CONNECTION = 4205

/**
 * Drops every open connection to a document, after any change to who may open it (share,
 * unshare, role change, trash, restore, purge). Each client reconnects and is authorized
 * again (ADR 0006); Hocuspocus stores the latest state as the document unloads, and Yjs
 * merges anything unsynced on reconnect, so nothing typed is lost.
 *
 * Hocuspocus's `closeConnections()` only ends the document's session on the socket, and the
 * provider then stays detached without retrying, so a promoted viewer or a collaborator who
 * kept access would never sync again. Closing the socket itself makes the provider reconnect
 * and authenticate afresh, as after a network drop.
 */
function closeConnections(server: Server, id: string) {
  const document = server.hocuspocus.documents.get(id)
  if (!document) return
  for (const connection of document.getConnections()) resetConnection(connection)
}

function resetConnection(connection: Connection) {
  // Detach from the document first, so nothing more this socket sends is applied to it.
  connection.close()
  connection.webSocket.close(RESET_CONNECTION, 'Reset Connection')
}

/** Moves an open document to the Trash. Its shares stay, inactive, until it is restored. */
async function moveToTrash(server: Server, id: string, actor: string) {
  const entry = entryOf(id)
  if (!entry || entry.trashedAt !== undefined) return
  docs[id] = { ...entry, trashedAt: Date.now() }
  await saveIndex()
  // Open tabs reconnect, are refused, and show a "moved to the trash" banner.
  closeConnections(server, id)
  audit('trash', { actor, doc: id, shares: Object.keys(entry.shares).length })
}

async function restoreFromTrash(server: Server, id: string, actor: string) {
  docs[id] = { ...docs[id], trashedAt: undefined }
  await saveIndex()
  closeConnections(server, id)
  audit('restore', { actor, doc: id, shares: Object.keys(docs[id].shares).length })
}

/**
 * Deletes documents forever, with their shares; their IDs are tombstoned (with the former
 * owner, so only they are told it was deleted) and can never be synced again. Only IDs still
 * in the Trash are purged, and that check and the index change happen synchronously, so a
 * document restored a moment earlier is never caught. Returns the purged IDs.
 *
 * @param actor Who asked, or `expiry` for the hourly 30-day cleanup.
 */
async function purge(server: Server, ids: string[], actor: string) {
  const purged = [...new Set(ids)].filter(isTrashed)
  if (!purged.length) return purged
  const removed = purged.map((id) => ({ id, entry: docs[id] }))
  for (const { id, entry } of removed) {
    deleted.set(id, entry.owner)
    delete docs[id]
  }
  await saveIndex()
  for (const id of purged) closeConnections(server, id)
  await Promise.all(purged.map((id) => rm(fileFor(id), { force: true })))
  for (const { id, entry } of removed) {
    audit('purge', { actor, doc: id, owner: entry.owner, shares: Object.keys(entry.shares).length })
  }
  return purged
}

const trashedIds = () => Object.keys(docs).filter(isTrashed)

/** The caller's own documents in the Trash. */
const isOwnTrashed = (id: string, user: User) => isTrashed(id) && entryOf(id)?.owner === user.email

function purgeExpired(server: Server) {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const expired = trashedIds().filter((id) => (docs[id].trashedAt ?? Infinity) <= cutoff)
  return purge(server, expired, 'expiry')
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

/** Copies the data dir into a new timestamped folder, keeps the newest few, and returns the new folder. */
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
  return join(backups, name)
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
  route: { id?: string; action?: string; sub?: string; server: Server<CollabContext>; user: User },
) => Promise<void>

/**
 * Parses `/:id/:action/:sub`, passes the caller (`user`) and handles errors. A malformed escape
 * (e.g. %E0) must not crash the server.
 */
function route({ server }: Runtime, handler: Handler): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // `identify()` runs first, so this only fails if the middleware order is broken.
    const user = requestUsers.get(req)
    if (!user) return send(res, 401, { error: 'unauthenticated' })
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // Longer paths are nobody's route.
      if (segments.length > 3) return next()
      const [id, action, sub] = segments
      await handler(req, res, next, { id, action, sub, server, user })
    } catch (error) {
      // Malformed escapes in the URL or malformed JSON bodies.
      if (error instanceof URIError || error instanceof SyntaxError) return send(res, 400, { error: 'bad request' })
      return send(res, 500, { error: error instanceof Error ? error.message : 'error' })
    }
  }
}

/** No access: the same answer whether the document never existed, is someone else's or was purged (ADR 0003). */
const notFound = (res: ServerResponse) => send(res, 404, { error: 'not found' })

/** The caller has a role, but not one that allows this. */
const forbidden = (res: ServerResponse) => send(res, 403, { error: 'forbidden' })

/** `/api/trash`: the caller's own Trash. List, restore, delete forever, empty. */
const trashApi = (runtime: Runtime) =>
  route(runtime, async (req, res, next, { id, action, sub, server, user }) => {
    if (sub) return next()
    if (!id && req.method === 'GET') {
      const list = trashedIds()
        .filter((docId) => isOwnTrashed(docId, user))
        .map(toTrashed)
        .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
      return send(res, 200, { docs: list, retentionDays: TRASH_RETENTION_MS / DAY })
    }

    // Empties the Trash as the caller saw it: only the IDs listed, so documents trashed in the
    // meantime are not deleted unseen. IDs that aren't the caller's own trashed documents are skipped.
    if (!id && req.method === 'DELETE') {
      const { ids } = await readJson(req)
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
        return send(res, 400, { error: 'expected { ids: string[] }' })
      }
      const purged = await purge(
        server,
        ids.filter((docId) => isOwnTrashed(docId, user)),
        user.email,
      )
      return send(res, 200, { purged: purged.length })
    }

    if (!id) return next()
    // Only the owner's documents in the Trash can be restored or deleted forever.
    if (!isOwnTrashed(id, user)) return notFound(res)

    if (action === 'restore' && !sub && req.method === 'POST') {
      await restoreFromTrash(server, id, user.email)
      return send(res, 200, toMeta(id, 'owner'))
    }

    if (!action && req.method === 'DELETE') {
      await purge(server, [id], user.email)
      return send(res, 204)
    }

    return next()
  })

/** `PUT|DELETE /api/docs/:id/shares/:email`. The caller's role on `id` is `role` (never null). */
async function sharesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  { id, target, role, server, user }: { id: string; target: string; role: Role; server: Server; user: User },
) {
  const email = normalizeEmail(target)
  const entry = docs[id]

  // Shares change only through the owner, except that a collaborator may remove their own
  // ("Remove from my list").
  if (req.method === 'DELETE') {
    if (role !== 'owner' && email !== user.email) return forbidden(res)
    if (shareOf(entry, email)) {
      const { [email]: removed, ...rest } = entry.shares
      docs[id] = { ...entry, shares: rest }
      await saveIndex()
      closeConnections(server, id)
      audit('unshare', { actor: user.email, doc: id, email, role: removed, self: email === user.email })
    }
    return send(res, 204)
  }

  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' })
  if (role !== 'owner') return forbidden(res)
  const body = await readJson(req)
  if (!isShareRole(body.role)) return send(res, 400, { error: 'role must be "editor" or "viewer"' })
  if (!isValidEmail(email)) return send(res, 400, { error: 'invalid email' })
  // The caller is the owner, so this also covers sharing with yourself.
  if (email === entry.owner) return send(res, 400, { error: 'the owner already has access' })
  const previous = shareOf(entry, email)
  if (!previous && Object.keys(entry.shares).length >= MAX_SHARES) {
    return send(res, 409, { error: `a document can be shared with at most ${MAX_SHARES} people` })
  }
  if (previous !== body.role) {
    docs[id] = { ...entry, shares: { ...entry.shares, [email]: body.role } satisfies Shares }
    await saveIndex()
    // A role change matters to open sockets too: a viewer's connection is read-only.
    closeConnections(server, id)
    audit(previous ? 'role_change' : 'share', {
      actor: user.email,
      doc: id,
      email,
      role: body.role,
      ...(previous ? { from: previous } : {}),
    })
  }
  return send(res, 200, toMeta(id, 'owner'))
}

/**
 * `/api/docs`: the library. Every handler for one document resolves the caller's role first,
 * before touching the document (in particular before `openDirectConnection` and `currentState`,
 * which skip the collaboration server's hooks).
 */
const docsApi = (runtime: Runtime) =>
  route(runtime, async (req, res, next, { id, action, sub, server, user }) => {
    // My documents and Shared with me: open documents the caller owns or has a share on.
    if (!id && req.method === 'GET') {
      const list: DocMeta[] = []
      for (const docId of Object.keys(docs)) {
        const role = roleFor(docId, user)
        if (role) list.push(toMeta(docId, role))
      }
      list.sort((a, b) => b.updatedAt - a.updatedAt)
      return send(res, 200, { docs: list })
    }

    // The only way to create a document: it belongs to the caller and has no shares.
    if (!id && req.method === 'POST') {
      const body = await readJson(req)
      const docId = newId()
      const doc = new Y.Doc()
      const title = cleanTitle(body.title)
      if (title) doc.getMap('meta').set('title', title)
      await writeAtomic(fileFor(docId), Y.encodeStateAsUpdate(doc))
      addEntry(docId, user.email, doc)
      await saveIndex()
      audit('create', { actor: user.email, doc: docId })
      return send(res, 201, toMeta(docId, 'owner'))
    }

    if (!id) return next()

    // Always 200, so opening a document doesn't log a failed request. `none` reveals nothing more.
    if (action === 'status' && !sub && req.method === 'GET') {
      return send(res, 200, statusFor(entryOf(id), deleted.get(id), user.email))
    }

    // Moves the document to the Trash (owner only). Repeating it is fine.
    if (!action && req.method === 'DELETE') {
      if (isOwnTrashed(id, user)) return send(res, 204)
      const role = roleFor(id, user)
      if (!role) return notFound(res)
      if (role !== 'owner') return forbidden(res)
      await moveToTrash(server, id, user.email)
      return send(res, 204)
    }

    const role = roleFor(id, user)
    if (!role) return notFound(res)

    if (action === 'shares' && sub) return sharesRoute(req, res, { id, target: sub, role, server, user })
    if (sub) return next()

    // Everyone with access sees who has access.
    if (!action && req.method === 'GET') return send(res, 200, toMeta(id, role, { withShares: true }))

    if (!action && req.method === 'PATCH') {
      if (!canEdit(role)) return forbidden(res)
      const title = cleanTitle((await readJson(req)).title)
      await setTitle(server, id, title)
      // Access may have changed while the title was being written.
      const after = roleFor(id, user)
      if (!after) return notFound(res)
      const state = await currentState(server, id)
      const doc = new Y.Doc()
      if (state) Y.applyUpdate(doc, state)
      updateIndexFromDoc(id, doc)
      docs[id] = { ...docs[id], title }
      await saveIndex()
      return send(res, 200, toMeta(id, after))
    }

    // Anyone with access may copy: the copy is the caller's, with no shares.
    if (action === 'duplicate' && req.method === 'POST') {
      const state = await currentState(server, id)
      const doc = new Y.Doc()
      if (state) Y.applyUpdate(doc, state)
      const sourceTitle = getTitle(doc) || extractText(doc).slice(0, 60) || 'Untitled document'
      doc.getMap('meta').set('title', `Copy of ${sourceTitle}`)
      const copyId = newId()
      await writeAtomic(fileFor(copyId), Y.encodeStateAsUpdate(doc))
      addEntry(copyId, user.email, doc)
      await saveIndex()
      audit('create', { actor: user.email, doc: copyId, from: id })
      return send(res, 201, toMeta(copyId, 'owner'))
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
