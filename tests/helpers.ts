/**
 * Test harness: runs the real Write server (`vite` or `vite preview`) as a child process with
 * its own data and backup dirs, plus a local JWKS server for Access mode.
 *
 * Ports are fixed so they never collide with the human's dev server (5173/1234):
 * Dev mode 5180/1240, Access mode 4180/1241.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose'
import * as Y from 'yjs'
import { docFileName } from '../server/collab.ts'

export const ROOT = resolve(import.meta.dirname, '..')
const VITE = join(ROOT, 'node_modules', '.bin', 'vite')

export const DEV_PORTS = { port: 5180, collabPort: 1240 }
export const PREVIEW_PORTS = { port: 4180, collabPort: 1241 }

export const TEAM_DOMAIN = 'write-test.cloudflareaccess.com'
export const AUD = 'test-aud-0123456789abcdef'

/** A fresh temp dir. `WRITE_TEST_TMP` picks where (default: the OS temp dir). */
export async function tempDir(prefix = 'test-data-') {
  return mkdtemp(join(process.env.WRITE_TEST_TMP ?? tmpdir(), prefix))
}

// ---------- Child processes ----------

const children = new Set<ChildProcess>()

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  // Each server runs in its own process group (detached), so this also reaches anything Vite spawned.
  try {
    if (child.pid) process.kill(-child.pid, signal)
  } catch {
    // already gone
  }
}

// Last resort if a test run is interrupted: never leave a server behind.
process.on('exit', () => {
  for (const child of children) killGroup(child, 'SIGKILL')
})

export type RunningServer = {
  child: ChildProcess
  url: string
  port: number
  collabPort: number
  dataDir: string
  backupDir: string
  /** Everything the process wrote to stdout and stderr so far. */
  output: () => string
  /** Resolves with the exit code when the process ends. */
  exited: Promise<number | null>
  stop: () => Promise<void>
}

type StartOptions = {
  command: 'dev' | 'preview'
  port: number
  collabPort: number
  env?: Record<string, string>
  /** For `preview`: the build to serve. */
  outDir?: string
  /** Writes fixture files into the (new, empty) data dir before the server starts. */
  seed?: (dataDir: string) => Promise<void>
}

/** Spawns `vite` (Dev mode) or `vite preview` (Access mode) with WRITE_* settings from `env`. */
export async function spawnServer({ command, port, collabPort, env = {}, outDir, seed }: StartOptions) {
  const dir = await tempDir()
  const dataDir = join(dir, 'data')
  if (seed) {
    await mkdir(dataDir, { recursive: true })
    await seed(dataDir)
  }
  // Only the variables given here: never inherit WRITE_* from the shell running the tests.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WRITE_')))
  const args = command === 'preview' ? ['preview', ...(outDir ? ['--outDir', outDir] : [])] : []
  const child = spawn(VITE, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...inherited,
      NO_COLOR: '1',
      WRITE_HOST: '127.0.0.1',
      WRITE_PORT: String(port),
      WRITE_COLLAB_PORT: String(collabPort),
      WRITE_DATA_DIR: dataDir,
      WRITE_BACKUP_DIR: join(dir, 'backups'),
      ...env,
    },
  })
  children.add(child)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const exited = new Promise<number | null>((resolveExit) =>
    child.once('exit', (code) => {
      children.delete(child)
      resolveExit(code)
    }),
  )
  const server: RunningServer = {
    child,
    url: `http://127.0.0.1:${port}`,
    port,
    collabPort,
    dataDir,
    backupDir: join(dir, 'backups'),
    output: () => output,
    exited,
    stop: async () => {
      if (children.has(child)) {
        killGroup(child, 'SIGTERM')
        const timer = setTimeout(() => killGroup(child, 'SIGKILL'), 3000)
        await exited
        clearTimeout(timer)
      }
      await rm(dir, { recursive: true, force: true })
    },
  }
  return server
}

/** Spawns a server and waits until it answers HTTP; throws with its output if it exits first. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const server = await spawnServer(options)
  const deadline = Date.now() + 20_000
  let exitCode: number | null | undefined
  void server.exited.then((code) => (exitCode = code))
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      await server.stop()
      throw new Error(`server exited (${exitCode}) before it was ready:\n${server.output()}`)
    }
    try {
      await fetch(`${server.url}/api/me`)
      return server
    } catch {
      await Bun.sleep(100)
    }
  }
  await server.stop()
  throw new Error(`server did not start in time:\n${server.output()}`)
}

/** Waits for the process to exit by itself (e.g. a refused start), killing it after `ms`. */
export async function exitCodeWithin(server: RunningServer, ms = 15_000) {
  const timeout = Bun.sleep(ms).then(() => 'timeout' as const)
  const result = await Promise.race([server.exited, timeout])
  await server.stop()
  return result
}

/** Builds the client once for `vite preview`. */
export async function buildClient() {
  const outDir = await tempDir('test-build-')
  const child = spawn(VITE, ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' })
  const code = await new Promise<number | null>((done) => child.once('exit', done))
  if (code !== 0) throw new Error(`vite build failed (${code})`)
  return outDir
}

// ---------- Cloudflare Access stand-in ----------

export type AccessKeys = {
  certsUrl: string
  /** Signs an Access-style JWT; `claims` override the defaults (valid for an hour, for alice). */
  sign: (claims?: JWTPayload, options?: { key?: CryptoKey; kid?: string }) => Promise<string>
  /** A key the JWKS doesn't list. */
  otherKey: CryptoKey
  /** `false` makes the key set answer 502, like Cloudflare's certs endpoint during an outage. */
  setAvailable: (available: boolean) => void
  stop: () => void
}

/** A local JWKS endpoint, like `https://<team>/cdn-cgi/access/certs`. */
export async function startAccessKeys(): Promise<AccessKeys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const other = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' }
  let available = true
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => (available ? Response.json({ keys: [jwk] }) : new Response('bad gateway', { status: 502 })),
  })
  const now = () => Math.floor(Date.now() / 1000)
  return {
    certsUrl: `http://127.0.0.1:${server.port}/cdn-cgi/access/certs`,
    otherKey: other.privateKey,
    sign: (claims = {}, { key = privateKey, kid = 'test-key-1' } = {}) =>
      new SignJWT({
        iss: `https://${TEAM_DOMAIN}`,
        aud: [AUD],
        email: 'alice@example.com',
        sub: 'user-alice',
        iat: now(),
        exp: now() + 3600,
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid })
        .sign(key),
    setAvailable: (next) => void (available = next),
    stop: () => void server.stop(true),
  }
}

// ---------- Requests ----------

/**
 * A request whose line and headers are sent now and whose body is sent only by `finish()`, like a
 * slow or deliberately stalled client: lets a test change access while the server waits for it.
 */
export function slowRequest(
  server: RunningServer,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string,
) {
  const socket = connect(server.port, '127.0.0.1')
  let response = ''
  const parse = () => {
    const [head = '', text = ''] = response.split('\r\n\r\n')
    return { status: Number(head.split(' ')[1]), body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined }
  }
  const done = new Promise<{ status: number; body?: Record<string, unknown> }>((resolveDone) => {
    socket.on('data', (chunk: Buffer) => (response += chunk.toString()))
    socket.once('close', () => resolveDone(parse()))
  })
  const all = { host: `127.0.0.1:${server.port}`, connection: 'close', ...headers, 'content-length': String(Buffer.byteLength(body)) }
  socket.write(`${method} ${path} HTTP/1.1\r\n${Object.entries(all).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`)
  return {
    /** Sends the body and resolves with the response. */
    finish: () => {
      socket.write(body)
      return done
    },
  }
}

export async function api(server: RunningServer, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const response = await fetch(`${server.url}${path}`, init)
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined }
}

export type CollabResult = { status: 'synced' } | { status: 'denied'; reason: string } | { status: 'timeout' }

/**
 * Opens a document with the real Hocuspocus provider, as the editor does (no token set),
 * sending `headers` on the WebSocket upgrade, and closes it again once it synced or was denied.
 */
export async function openDocument(url: string, name: string, headers: Record<string, string>): Promise<CollabResult> {
  const live = await connectDocument(url, name, headers)
  live.destroy()
  const outcome = live.events.find((event) => event === 'synced' || event.startsWith('denied:'))
  if (outcome === 'synced') return { status: 'synced' }
  if (outcome) return { status: 'denied', reason: outcome.slice('denied:'.length) }
  return { status: 'timeout' }
}

/** An open collaboration connection that stays open, recording what happens to it. */
export type LiveDocument = {
  doc: Y.Doc
  provider: HocuspocusProvider
  /** In order: `authenticated:<scope>`, `synced`, `denied:<reason>`, `close`. */
  events: string[]
  /** Waits until an event matching `pattern` arrives after the first `from` events. */
  waitFor: (pattern: RegExp, options?: { from?: number; ms?: number }) => Promise<string>
  destroy: () => void
}

/**
 * Like `openDocument`, but keeps the connection open. Resolves once it is synced or denied.
 * `clientID` sets the Yjs client ID (and so the presence ID), e.g. to reconnect as the same tab.
 */
export async function connectDocument(
  url: string,
  name: string,
  headers: Record<string, string>,
  { clientID }: { clientID?: number } = {},
): Promise<LiveDocument> {
  class WebSocketWithHeaders extends WebSocket {
    constructor(target: string | URL) {
      super(target, { headers } as unknown as string[])
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: WebSocketWithHeaders })
  const doc = new Y.Doc()
  if (clientID !== undefined) doc.clientID = clientID
  const events: string[] = []
  const waiters = new Set<() => void>()
  const record = (event: string) => {
    events.push(event)
    for (const wake of waiters) wake()
  }
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name,
    document: doc,
    onAuthenticated: ({ scope }) => record(`authenticated:${scope}`),
    onSynced: () => record('synced'),
    onAuthenticationFailed: ({ reason }) => record(`denied:${reason}`),
    onClose: () => record('close'),
  })
  provider.attach()
  const waitFor: LiveDocument['waitFor'] = (pattern, { from = 0, ms = 5000 } = {}) =>
    new Promise((done, fail) => {
      const check = () => {
        const found = events.slice(from).find((event) => pattern.test(event))
        if (found === undefined) return false
        clearTimeout(timer)
        waiters.delete(check)
        done(found)
        return true
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        fail(new Error(`no ${pattern} event within ${ms} ms; got ${events.join(', ') || 'nothing'}`))
      }, ms)
      if (!check()) waiters.add(check)
    })
  const live: LiveDocument = {
    doc,
    provider,
    events,
    waitFor,
    destroy: () => {
      provider.destroy()
      socket.destroy()
    },
  }
  await waitFor(/^(synced|denied:)/).catch(() => undefined)
  return live
}

/** Plain text of a document's editor content, as the server has it now (via a fresh connection). */
export async function readText(url: string, name: string, headers: Record<string, string>) {
  const live = await connectDocument(url, name, headers)
  try {
    if (!live.events.includes('synced')) throw new Error(`could not open ${name}: ${live.events.join(', ')}`)
    return live.doc.getXmlFragment('default').toString()
  } finally {
    live.destroy()
  }
}

/** Appends a paragraph to a document's editor content, as the editor would. */
export function typeParagraph(doc: Y.Doc, text: string) {
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText(text)])
  const fragment = doc.getXmlFragment('default')
  fragment.insert(fragment.length, [paragraph])
}

// ---------- Fixtures ----------

/** The original contents of the version-1 index written by `writeV1Fixture`. */
export type V1Fixture = { indexText: string }

/**
 * A data dir from before ownership (index version 1): an open document with text, a trashed
 * one, a tombstone, and an orphan `.ydoc` file that was never indexed.
 */
export async function writeV1Fixture(dataDir: string, { docs = true } = {}): Promise<V1Fixture> {
  const now = Date.now()
  const entry = (title: string, extra = {}) => ({ title, preview: '', words: 0, createdAt: now, updatedAt: now, ...extra })
  const index = docs
    ? {
        docs: {
          'legacy-one': entry('Legacy one'),
          'legacy-trashed': entry('Legacy trashed', { trashedAt: now }),
        },
        deleted: ['legacy-gone'],
      }
    : { docs: {}, deleted: [] }
  const indexText = JSON.stringify(index, null, 2)
  await writeFile(join(dataDir, 'index.json'), indexText)
  const ydoc = (text: string) => {
    const doc = new Y.Doc()
    typeParagraph(doc, text)
    return Y.encodeStateAsUpdate(doc)
  }
  if (docs) {
    await writeFile(join(dataDir, docFileName('legacy-one')), ydoc('legacy content'))
    await writeFile(join(dataDir, docFileName('legacy-trashed')), ydoc('trashed content'))
  }
  await writeFile(join(dataDir, docFileName('orphan-doc')), ydoc('orphan content'))
  return { indexText }
}
