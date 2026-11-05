import { Database } from '@hocuspocus/extension-database'
import { Server, type Connection, type Document } from '@hocuspocus/server'
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
import { createPdfRenderer, PdfBusy, PdfTimeout, PdfTooLarge, PdfUnavailable, type PdfRenderer } from './pdf.ts'
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
  type ShareRole,
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
 * Changes a document's index entry in one synchronous step that reads the entry at write time,
 * so no handler ever writes back a copy taken before an `await` (a request body, the disk) over
 * a change made meanwhile: a share, a trash, a purge. Changes nothing and returns undefined when
 * the document is gone, or is not in the state the change applies to.
 */
function updateEntry(
  id: string,
  state: 'open' | 'trashed' | 'any',
  change: (entry: IndexEntry) => IndexEntry,
): IndexEntry | undefined {
  const entry = entryOf(id)
  if (!entry) return undefined
  const trashed = entry.trashedAt !== undefined
  if ((state === 'open' && trashed) || (state === 'trashed' && !trashed)) return undefined
  return (docs[id] = change(entry))
}

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
  const text = extractText(doc)
  // Spread the entry so other fields (owner, shares, trashedAt) survive.
  return updateEntry(id, 'any', (entry) => ({
    ...entry,
    title: getTitle(doc),
    preview: text.slice(0, 400),
    words: text ? text.split(' ').length : 0,
    updatedAt: Date.now(),
  }))
}

/** Adds a new document to the index, owned by `owner`, with no shares. */
function addEntry(id: string, owner: string, doc: Y.Doc): IndexEntry {
  const now = Date.now()
  const entry: IndexEntry = { title: '', preview: '', words: 0, createdAt: now, updatedAt: now, owner, shares: {} }
  docs[id] = entry
  return updateIndexFromDoc(id, doc) ?? entry
}

/**
 * A document as someone with `role` sees it. Shares are listed for the owner, or for anyone
 * when `withShares` is set (`GET /:id`: everyone with access sees who has access).
 */
function toMeta(id: string, entry: IndexEntry, role: Role, { withShares = false } = {}): DocMeta {
  const { shares, ...rest } = entry
  return { id, ...rest, role, ...(withShares || role === 'owner' ? { shares: { ...shares } } : {}) }
}

const toTrashed = (id: string, entry: IndexEntry) => ({
  ...toMeta(id, entry, 'owner'),
  purgeAt: (entry.trashedAt ?? 0) + TRASH_RETENTION_MS,
})

const newId = () => randomBytes(9).toString('base64url')

// ---------- Collaboration server ----------

/** What Hocuspocus hooks see as `context` once a connection is authenticated. */
type CollabContext = { user: User; role: Role }

/** A running collaboration server and the configuration it was started with. */
type Runtime = {
  server: Server<CollabContext>
  config: WriteConfig
  authenticator: Authenticator
  /** The hourly Trash expiry and backup timer. */
  maintenance: ReturnType<typeof setInterval>
  /** Download as PDF. */
  pdf: PdfRenderer
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

/** WebSocket close code for "access changed, reconnect" (Hocuspocus's own "Reset Connection"). */
const RESET_CONNECTION = 4205
/** WebSocket close code for "can't check who you are right now, reconnect later" (RFC 6455's 1013). */
const TRY_AGAIN_LATER = 1013

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

/**
 * Presence (awareness) client IDs belong to the User who first sent them. Hocuspocus applies
 * awareness for any Yjs client ID, and a read-only connection's too, so without this anyone on a
 * document could rewrite or remove someone else's caret and name.
 *
 * An ID stays its User's while they are connected to the document, and for a while after their
 * last connection closes: every access change resets every socket on the document, and whoever
 * reconnects first must not take over the IDs of the people still reconnecting. Their own new
 * connections may use them again. Kept by document name, because a document is unloaded when
 * its last connection closes.
 */
const PRESENCE_HOLD_MS = 60_000

function presenceOwners() {
  /** Document name → client ID → its User, and when their last connection closed. */
  const byDocument = new Map<string, Map<number, { email: string; leftAt?: number }>>()
  const isConnected = (document: Document, email: string) =>
    document.getConnections().some((connection) => (connection.context as Partial<CollabContext>).user?.email === email)
  const isHeld = (document: Document, owner: { email: string; leftAt?: number }) =>
    isConnected(document, owner.email) || (owner.leftAt !== undefined && Date.now() - owner.leftAt < PRESENCE_HOLD_MS)

  return {
    /** Whether `email` may set or remove the presence of `clientId`; if so, it is theirs from now on. */
    mayUpdate(document: Document, email: string, clientId: number) {
      let owners = byDocument.get(document.name)
      if (!owners) byDocument.set(document.name, (owners = new Map()))
      const owner = owners.get(clientId)
      if (owner && owner.email !== email && isHeld(document, owner)) return false
      owners.set(clientId, { email })
      return true
    },
    /** One of `email`'s connections to the document closed. Also forgets IDs no longer held. */
    disconnected(document: Document, email: string) {
      const owners = byDocument.get(document.name)
      if (!owners) return
      for (const [clientId, owner] of owners) {
        if (owner.email === email) owner.leftAt = Date.now()
        else if (!isHeld(document, owner)) owners.delete(clientId)
      }
      if (!owners.size) byDocument.delete(document.name)
    },
  }
}

async function startRuntime(config: WriteConfig): Promise<Runtime> {
  indexState.dirs = { data: config.dataDir, backups: config.backupDir }
  await mkdir(config.dataDir, { recursive: true })
  const authenticator = createAuthenticator(config.auth)
  // The port is bound before the index is loaded (and maybe migrated), so a start that can't
  // succeed changes nothing: e.g. an older server still holds the port after a `git pull`.
  // Connections wait for the index meanwhile.
  let indexLoaded = () => {}
  const indexReady = new Promise<void>((done) => (indexLoaded = done))
  const presence = presenceOwners()
  // Hooks get the upgrade request but not its socket: remember which socket each request opened.
  const sockets = new WeakMap<Request, { close: (code: number, reason: string) => void }>()
  const server = new Server<CollabContext>({
    port: config.collabPort,
    address: '127.0.0.1',
    quiet: true,
    // Vite owns the process signals; the server is stopped when Vite's server closes.
    stopOnSignals: false,
    // Persist quickly so little is lost if the dev server is stopped abruptly.
    debounce: 500,
    maxDebounce: 2000,
    // Runs for every document on every socket, before anything syncs. The provider always sends
    // an auth message (an empty token when none is set), so no token is needed on the client: the
    // identity comes from the upgrade request's headers, which Vite's proxy passes through. This
    // check runs here, not in the proxy, because anything on this machine can reach 127.0.0.1.
    async onAuthenticate({ request, requestHeaders, documentName, connectionConfig }) {
      await indexReady
      const header = fetchHeaders(requestHeaders)
      const identity = await identifyRequest(authenticator, header, {
        checkOrigin: true,
        allowedOrigins: config.allowedOrigins,
      })
      if (!identity.ok) {
        logAuthFailure(identity, { via: 'collab', doc: documentName, ip: clientIp(header) })
        // The identity can't be checked right now (Access's signing keys are unavailable). A
        // refused document is never retried on a socket that stays open, so close the socket:
        // the client reconnects, and is checked again, once the keys are back.
        if (identity.status === 503) sockets.get(request)?.close(TRY_AGAIN_LATER, 'Try Again Later')
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
    // `closeConnections` only reaches connections already registered on the document. One that
    // was still loading the document when access changed is caught here, before any of its
    // messages (including those queued while it authenticated) is applied, ...
    async beforeHandleMessage({ documentName, context, connection }) {
      if (roleFor(documentName, context.user) === context.role) return
      resetConnection(connection)
      throw new CollabRejection('permission-denied')
    },
    // ... and here, if it sent nothing before it was registered: then it would still receive updates.
    async connected({ documentName, context, connection }) {
      if (roleFor(documentName, context.user) !== context.role) resetConnection(connection)
    },
    async beforeHandleAwareness({ document, context, states, removedClients }) {
      // Only updates from a client connection have a context.
      const email = context?.user.email
      if (!email) return
      for (const clientId of [...states.keys()]) {
        if (!presence.mayUpdate(document, email, clientId)) states.delete(clientId)
      }
      for (const clientId of [...removedClients]) {
        if (!presence.mayUpdate(document, email, clientId)) removedClients.delete(clientId)
      }
    },
    async onDisconnect({ document, context }) {
      const email = (context as Partial<CollabContext> | undefined)?.user?.email
      if (email) presence.disconnected(document, email)
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
  const { hocuspocus } = server
  const handleConnection = hocuspocus.handleConnection.bind(hocuspocus)
  hocuspocus.handleConnection = (websocket, request, context) => {
    sockets.set(request, websocket)
    return handleConnection(websocket, request, context)
  }
  await listen(server, config.collabPort)
  try {
    await loadIndex(config)
  } catch (error) {
    await server.destroy()
    throw error
  }
  indexLoaded()
  const maintenance = startMaintenance(server)
  console.log(describeConfig(config))
  // Logs a warning if Chromium is missing; the browser itself starts on the first export.
  const pdf = createPdfRenderer(config.pdf)
  return { server, config, authenticator, maintenance, pdf }
}

/**
 * Stops a collaboration server and frees its port: open documents are stored and unloaded
 * (clients reconnect to the next server), the index is written, and the in-memory index is
 * forgotten so the next server reads it afresh from its own data dir.
 */
async function stopRuntime({ server, maintenance, pdf }: Runtime) {
  clearInterval(maintenance)
  await pdf.close()
  // destroy() closes every connection, stores and unloads every document, and closes the port.
  // A document held open by a request in progress could keep it waiting, so don't wait forever.
  // (The port itself is closed at once.)
  await Promise.race([server.destroy(), new Promise((done) => setTimeout(done, 5000).unref())])
  try {
    await saveIndex()
  } catch (error) {
    console.error('[write] writing the document index failed:', error)
  }
  for (const id of Object.keys(docs)) delete docs[id]
  deleted.clear()
  indexState.loaded = false
}

/**
 * One Vite server's collaboration server. Vite restarts in-process when `vite.config.ts`, a
 * file it imports (like this one) or an `.env` file changes: it creates the new server, with a
 * fresh copy of this module and of the configuration, before it closes the old one. So each
 * Vite server gets its own instance, which starts only once the previous one has stopped and
 * released the collaboration port, and which stops when its Vite server closes.
 */
type Instance = {
  runtime: Promise<Runtime>
  /** Set once `stopped` has resolved. */
  isStopped: boolean
  /** Resolves once this instance's server has stopped (or never started). */
  stopped: Promise<void>
  stop: () => Promise<void>
}

const globalKey = Symbol.for('write.collabServer.v3')
const processState = globalThis as typeof globalThis & { [globalKey]?: Instance }

function createInstance(config: WriteConfig): Instance {
  const previous = processState[globalKey]
  const runtime = (previous ? previous.stopped : Promise.resolve()).then(() => startRuntime(config))
  let resolveStopped = () => {}
  const stopped = new Promise<void>((done) => (resolveStopped = done))
  const markStopped = () => {
    instance.isStopped = true
    resolveStopped()
  }
  let stopping: Promise<void> | undefined
  const instance: Instance = {
    runtime,
    isStopped: false,
    stopped,
    stop: () =>
      (stopping ??= runtime
        .then(stopRuntime, () => undefined)
        .finally(() => {
          if (processState[globalKey] === instance) delete processState[globalKey]
          markStopped()
        })),
  }
  // A server that failed to start holds no port: the next one may start right away.
  runtime.catch(() => markStopped())
  processState[globalKey] = instance
  return instance
}

// ---------- Trash ----------

/** The current Yjs state of a document: from memory if it's open, otherwise from disk. */
async function currentState(server: Server, id: string) {
  const loaded = server.hocuspocus.documents.get(id)
  return loaded ? Y.encodeStateAsUpdate(loaded) : readState(id)
}


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

/**
 * Moves an open document to the Trash; its shares stay, inactive, until it is restored. Changes
 * the index in memory (the caller saves it) and returns the entry, or undefined if it wasn't open.
 */
function moveToTrash(server: Server, id: string, actor: string) {
  const entry = updateEntry(id, 'open', (current) => ({ ...current, trashedAt: Date.now() }))
  if (!entry) return undefined
  // Open tabs reconnect, are refused, and show a "moved to the trash" banner.
  closeConnections(server, id)
  audit('trash', { actor, doc: id, shares: Object.keys(entry.shares).length })
  return entry
}

/** Restores a trashed document and its shares, like `moveToTrash` (the caller saves the index). */
function restoreFromTrash(server: Server, id: string, actor: string) {
  const entry = updateEntry(id, 'trashed', (current) => {
    const restored = { ...current }
    delete restored.trashedAt
    return restored
  })
  if (!entry) return undefined
  closeConnections(server, id)
  audit('restore', { actor, doc: id, shares: Object.keys(entry.shares).length })
  return entry
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
  const removed = purged.flatMap((id) => {
    const entry = entryOf(id)
    return entry ? [{ id, entry }] : []
  })
  for (const { id, entry } of removed) {
    deleted.set(id, entry.owner)
    delete docs[id]
  }
  for (const id of purged) closeConnections(server, id)
  await saveIndex()
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
  const expired = trashedIds().filter((id) => (entryOf(id)?.trashedAt ?? Infinity) <= cutoff)
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
  return setInterval(() => void run(), HOUR).unref()
}

// ---------- REST API ----------

/** Request bodies are small JSON objects: a title, a role, a list of IDs. */
const MAX_BODY_BYTES = 64 * 1024

/** An error with the response it should become. */
class HttpError {
  readonly status: number
  readonly error: string
  constructor(status: number, error: string) {
    this.status = status
    this.error = error
  }
}

/** Reads a JSON object body, up to `MAX_BODY_BYTES` (413 beyond; 400 if it isn't JSON). */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const tooLarge = new HttpError(413, 'request body too large')
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw tooLarge
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw tooLarge
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'bad request')
  }
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const cleanTitle = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '')

// ---------- Identity ----------

/** The collaboration server and the caller of each `/api/*` request, set by `identify()`. */
type RequestContext = { runtime: Runtime; user: User }
const requests = new WeakMap<IncomingMessage, RequestContext>()

/**
 * Runs first for every `/api/*` request: the Origin check for anything but GET and HEAD,
 * then the caller's identity. Without one the request ends here with 401 (or 403 for a
 * foreign origin or a token without an email, 503 when it can't be checked).
 */
const identify =
  (instance: Instance): Connect.NextHandleFunction =>
  async (req, res, next) => {
    let runtime: Runtime
    try {
      // Only waits while the server (re)starts.
      runtime = await instance.runtime
    } catch {
      return send(res, 503, { error: 'unavailable' })
    }
    const header = nodeHeaders(req.headers)
    let identity: Identity
    try {
      identity = await identifyRequest(runtime.authenticator, header, {
        checkOrigin: req.method !== 'GET' && req.method !== 'HEAD',
        allowedOrigins: runtime.config.allowedOrigins,
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
    requests.set(req, { runtime, user: identity.user })
    next()
  }

/** `GET /api/me`: who the server thinks the caller is. */
const meApi: Connect.NextHandleFunction = (req, res, next) => {
  if (req.method !== 'GET' || new URL(req.url ?? '/', 'http://localhost').pathname !== '/') return next()
  const context = requests.get(req)
  if (!context) return send(res, 401, { error: 'unauthenticated' })
  return send(res, 200, { email: context.user.email, mode: context.runtime.config.auth.mode })
}

// ---------- REST API handlers ----------

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
  route: {
    id?: string
    action?: string
    sub?: string
    /** The JSON body, already read (`{}` for GET and HEAD). */
    body: Record<string, unknown>
    server: Server<CollabContext>
    user: User
    runtime: Runtime
  },
) => Promise<void>

/**
 * Parses `/:id/:action/:sub`, reads the body and handles errors. The body is read **before**
 * the handler runs, so a handler resolves the caller's role and acts on it with nothing awaited
 * in between: a client can't send the headers, wait for its access to change, then the body.
 */
function route(handler: Handler): Connect.NextHandleFunction {
  return async (req, res, next) => {
    // `identify()` runs first, so this only fails if the middleware order is broken.
    const context = requests.get(req)
    if (!context) return send(res, 401, { error: 'unauthenticated' })
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // Longer paths are nobody's route.
      if (segments.length > 3) return next()
      const [id, action, sub] = segments
      const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJson(req)
      await handler(req, res, next, {
        id,
        action,
        sub,
        body,
        server: context.runtime.server,
        user: context.user,
        runtime: context.runtime,
      })
    } catch (error) {
      // A malformed escape in the URL (e.g. %E0) must not crash the server.
      if (error instanceof URIError) return send(res, 400, { error: 'bad request' })
      if (error instanceof HttpError) {
        // The rest of an oversized body is never read; don't reuse the connection.
        if (error.status === 413) res.setHeader('Connection', 'close')
        return send(res, error.status, { error: error.error })
      }
      // Details (paths, internals) go to the log, not to the client.
      console.error(`[write] ${req.method} ${req.originalUrl ?? req.url} failed:`, error)
      return send(res, 500, { error: 'error' })
    }
  }
}

/** No access: the same answer whether the document never existed, is someone else's or was purged (ADR 0003). */
const notFound = (res: ServerResponse) => send(res, 404, { error: 'not found' })

/** The caller has a role, but not one that allows this. */
const forbidden = (res: ServerResponse) => send(res, 403, { error: 'forbidden' })

/** `/api/trash`: the caller's own Trash. List, restore, delete forever, empty. */
const trashApi = route(async (req, res, next, { id, action, sub, body, server, user }) => {
  if (sub) return next()
  if (!id && req.method === 'GET') {
    const list = trashedIds()
      .flatMap((docId) => {
        const entry = entryOf(docId)
        return entry && isOwnTrashed(docId, user) ? [toTrashed(docId, entry)] : []
      })
      .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
    return send(res, 200, { docs: list, retentionDays: TRASH_RETENTION_MS / DAY })
  }

  // Empties the Trash as the caller saw it: only the IDs listed, so documents trashed in the
  // meantime are not deleted unseen. IDs that aren't the caller's own trashed documents are skipped.
  if (!id && req.method === 'DELETE') {
    const { ids } = body
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

  if (action === 'restore' && req.method === 'POST') {
    const entry = restoreFromTrash(server, id, user.email)
    if (!entry) return notFound(res)
    await saveIndex()
    return send(res, 200, toMeta(id, entry, 'owner'))
  }

  if (!action && req.method === 'DELETE') {
    await purge(server, [id], user.email)
    return send(res, 204)
  }

  return next()
})

/**
 * `PUT|DELETE /api/docs/:id/shares/:email`. `role` is the caller's role on `id`, resolved in the
 * same synchronous step as the change.
 */
async function sharesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  {
    id,
    target,
    role,
    body,
    server,
    user,
  }: { id: string; target: string; role: Role; body: Record<string, unknown>; server: Server; user: User },
) {
  const email = normalizeEmail(target)

  // Shares change only through the owner, except that a collaborator may remove their own
  // ("Remove from my list").
  if (req.method === 'DELETE') {
    if (role !== 'owner' && email !== user.email) return forbidden(res)
    let removed: ShareRole | null = null
    updateEntry(id, 'open', (entry) => {
      removed = shareOf(entry, email)
      if (!removed) return entry
      const { [email]: _, ...shares } = entry.shares
      return { ...entry, shares }
    })
    if (removed) {
      closeConnections(server, id)
      audit('unshare', { actor: user.email, doc: id, email, role: removed, self: email === user.email })
      await saveIndex()
    }
    return send(res, 204)
  }

  if (req.method !== 'PUT') return send(res, 405, { error: 'method not allowed' })
  if (role !== 'owner') return forbidden(res)
  const next = body.role
  if (!isShareRole(next)) return send(res, 400, { error: 'role must be "editor" or "viewer"' })
  if (!isValidEmail(email)) return send(res, 400, { error: 'invalid email' })
  const current = entryOf(id)
  if (!current) return notFound(res)
  // The caller is the owner, so this also covers sharing with yourself.
  if (email === current.owner) return send(res, 400, { error: 'the owner already has access' })
  const previous = shareOf(current, email)
  if (!previous && Object.keys(current.shares).length >= MAX_SHARES) {
    return send(res, 409, { error: `a document can be shared with at most ${MAX_SHARES} people` })
  }
  if (previous === next) return send(res, 200, toMeta(id, current, 'owner'))
  const entry = updateEntry(id, 'open', (latest) => ({ ...latest, shares: { ...latest.shares, [email]: next } }))
  if (!entry) return notFound(res)
  // A role change matters to open sockets too: a viewer's connection is read-only.
  closeConnections(server, id)
  audit(previous ? 'role_change' : 'share', {
    actor: user.email,
    doc: id,
    email,
    role: next,
    ...(previous ? { from: previous } : {}),
  })
  const meta = toMeta(id, entry, 'owner')
  await saveIndex()
  return send(res, 200, meta)
}

/** RFC 5987 `attr-char` leaves out `'()*!`, which `encodeURIComponent` keeps. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * A download file name from a document's title: no path separators, quotes or control characters,
 * at most 120 characters (whole code points, so an emoji is never cut in half; a lone surrogate
 * from a client becomes U+FFFD), as `filename="…"` (ASCII) and `filename*=UTF-8''…` (the title).
 */
export function pdfDisposition(title: string) {
  const cleaned = (title as string & { toWellFormed: () => string })
    .toWellFormed()
    // oxlint-disable-next-line no-control-regex -- control characters are what this removes
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const name = Array.from(cleaned).slice(0, 120).join('').replace(/^[.\s-]+|[.\s-]+$/g, '') || 'Untitled document'
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_')
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeRfc5987(`${name}.pdf`)}`
}

/** What people see when the server can't make PDFs (no Chromium); the details are in the server's log. */
const PDF_UNAVAILABLE = 'PDF download isn’t set up on this server yet. Ask whoever runs Write to install Chromium for it (see the server log).'

/**
 * `GET /api/docs/:id/pdf`: the document as a PDF, with its page setup and page numbers and no
 * browser headers (server/pdf.ts). The caller has a role; it is checked again after the state is
 * read, like `duplicate`. 413 when the document is larger than `WRITE_PDF_MAX_MB`; 503 when
 * Chromium isn't installed, too many exports are running, or the export runs out of time.
 */
async function pdfRoute(
  res: ServerResponse,
  { id, server, user, runtime }: { id: string; server: Server; user: User; runtime: Runtime },
) {
  const { pdf } = runtime
  // The reason (a path, how to install) is for whoever runs the server: it is in the log.
  const unavailable = () => send(res, 503, { error: 'pdf unavailable', message: PDF_UNAVAILABLE })
  if (pdf.unavailable) return unavailable()
  const state = await currentState(server, id)
  if (!roleFor(id, user)) return notFound(res)
  let result: { pdf: Buffer; title: string }
  try {
    result = await pdf.exportDocument(state)
  } catch (error) {
    if (error instanceof PdfTooLarge) return send(res, 413, { error: 'document too large for a PDF' })
    if (error instanceof PdfBusy) {
      res.setHeader('Retry-After', '5')
      return send(res, 503, { error: 'busy', message: 'Too many PDF downloads at once. Try again in a moment.' })
    }
    if (error instanceof PdfUnavailable) {
      return send(res, 503, { error: 'pdf unavailable', message: 'The server is restarting. Try again in a moment.' })
    }
    if (error instanceof PdfTimeout) {
      console.warn(`[write] PDF export of ${id} timed out`)
      return send(res, 503, { error: 'timed out', message: 'The PDF took too long to make. Try again in a moment.' })
    }
    console.error(`[write] PDF export of ${id} failed:`, error)
    return send(res, 503, { error: 'pdf failed', message: 'The PDF could not be made. Try again in a moment.' })
  }
  // Every header first: nothing is audited for a download that doesn't go out.
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': pdfDisposition(result.title),
    'Content-Length': String(result.pdf.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  audit('export', { actor: user.email, doc: id, format: 'pdf', bytes: result.pdf.length })
  res.writeHead(200, headers)
  res.end(result.pdf)
}

/**
 * `/api/docs`: the library. Every handler for one document resolves the caller's role first,
 * and acts on it without awaiting anything in between; in particular before
 * `openDirectConnection` and `currentState`, which skip the collaboration server's hooks,
 * and checking again after them.
 */
const docsApi = route(async (req, res, next, { id, action, sub, body, server, user, runtime }) => {
  // My documents and Shared with me: open documents the caller owns or has a share on.
  if (!id && req.method === 'GET') {
    const list: DocMeta[] = []
    for (const docId of Object.keys(docs)) {
      const entry = entryOf(docId)
      const role = roleOf(entry, user.email)
      if (entry && role) list.push(toMeta(docId, entry, role))
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return send(res, 200, { docs: list })
  }

  // The only way to create a document: it belongs to the caller and has no shares.
  if (!id && req.method === 'POST') {
    const docId = newId()
    const doc = new Y.Doc()
    const title = cleanTitle(body.title)
    if (title) doc.getMap('meta').set('title', title)
    await writeAtomic(fileFor(docId), Y.encodeStateAsUpdate(doc))
    const entry = addEntry(docId, user.email, doc)
    audit('create', { actor: user.email, doc: docId })
    const meta = toMeta(docId, entry, 'owner')
    await saveIndex()
    return send(res, 201, meta)
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
    moveToTrash(server, id, user.email)
    await saveIndex()
    return send(res, 204)
  }

  const entry = entryOf(id)
  const role = roleOf(entry, user.email)
  if (!entry || !role) return notFound(res)

  if (action === 'shares' && sub) return sharesRoute(req, res, { id, target: sub, role, body, server, user })
  if (sub) return next()

  // Everyone with access sees who has access.
  if (!action && req.method === 'GET') return send(res, 200, toMeta(id, entry, role, { withShares: true }))

  if (!action && req.method === 'PATCH') {
    if (!canEdit(role)) return forbidden(res)
    const title = cleanTitle(body.title)
    // Writes the title into the live Yjs document, so open editors update immediately.
    const connection = await server.hocuspocus.openDirectConnection(id)
    let now = null as Role | null
    let renamed = undefined as IndexEntry | undefined
    try {
      await connection.transact((doc) => {
        // Access may have changed while the document loaded: check again, in the same step as the write.
        now = roleFor(id, user)
        if (!canEdit(now)) return
        doc.getMap('meta').set('title', title)
        renamed = updateIndexFromDoc(id, doc)
      })
    } finally {
      await connection.disconnect()
    }
    if (!renamed || !now) return now ? forbidden(res) : notFound(res)
    const meta = toMeta(id, renamed, now)
    await saveIndex()
    return send(res, 200, meta)
  }

  // Anyone with access may download it, viewers too, like any export.
  if (action === 'pdf' && req.method === 'GET') return pdfRoute(res, { id, server, user, runtime })

  // Anyone with access may copy: the copy is the caller's, with no shares.
  if (action === 'duplicate' && req.method === 'POST') {
    const state = await currentState(server, id)
    // Access may have changed while the document was read.
    if (!roleFor(id, user)) return notFound(res)
    const doc = new Y.Doc()
    if (state) Y.applyUpdate(doc, state)
    const sourceTitle = getTitle(doc) || extractText(doc).slice(0, 60) || 'Untitled document'
    doc.getMap('meta').set('title', `Copy of ${sourceTitle}`)
    const copyId = newId()
    await writeAtomic(fileFor(copyId), Y.encodeStateAsUpdate(doc))
    const copy = addEntry(copyId, user.email, doc)
    audit('create', { actor: user.email, doc: copyId, from: id })
    const meta = toMeta(copyId, copy, 'owner')
    await saveIndex()
    return send(res, 201, meta)
  }

  return next()
})

/** Mounts the API for one Vite server, served by `instance`'s collaboration server. */
function mount(middlewares: Connect.Server, instance: Instance) {
  // Identity first: nothing under /api is served without one.
  middlewares.use('/api', identify(instance))
  middlewares.use('/api/me', meApi)
  middlewares.use('/api/docs', docsApi)
  middlewares.use('/api/trash', trashApi)
  // Unknown API paths get a JSON 404, not the app's index.html.
  middlewares.use('/api', (_req, res) => send(res, 404, { error: 'not found' }))
}

/** The Vite plugin. `config` comes from `resolveConfig()` in `vite.config.ts`. */
export function collabServer(config: WriteConfig): Plugin {
  let instance: Instance | undefined
  const start = async (middlewares: Connect.Server) => {
    const previous = processState[globalKey]
    const restarting = previous !== undefined && !previous.isStopped
    instance = createInstance(config)
    mount(middlewares, instance)
    if (restarting) {
      // Vite closes the old server (which stops its collaboration server and frees the port)
      // only after this one is set up, so don't wait here: requests wait for the runtime.
      instance.runtime.catch((error: unknown) => console.error('[write] the collaboration server did not restart:', error))
    } else {
      // A first start that fails (port in use, a migration refused) stops Vite.
      await instance.runtime
    }
  }
  const stop = async () => {
    await instance?.stop()
  }
  return {
    name: 'write:collab-server',
    configureServer: (vite) => start(vite.middlewares),
    configurePreviewServer: (preview) => start(preview.middlewares),
    // Vite awaits these: on a restart and on shutdown, documents are stored and the port freed.
    closeServer: stop,
    closePreviewServer: stop,
  }
}
