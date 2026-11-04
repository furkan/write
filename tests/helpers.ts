/**
 * Test harness: runs the real Write server (`vite` or `vite preview`) as a child process with
 * its own data and backup dirs, plus a local JWKS server for Access mode.
 *
 * Ports are fixed so they never collide with the human's dev server (5173/1234):
 * Dev mode 5180/1240, Access mode 4180/1241.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose'
import * as Y from 'yjs'

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
}

/** Spawns `vite` (Dev mode) or `vite preview` (Access mode) with WRITE_* settings from `env`. */
export async function spawnServer({ command, port, collabPort, env = {}, outDir }: StartOptions) {
  const dir = await tempDir()
  const dataDir = join(dir, 'data')
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
  stop: () => void
}

/** A local JWKS endpoint, like `https://<team>/cdn-cgi/access/certs`. */
export async function startAccessKeys(): Promise<AccessKeys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const other = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ keys: [jwk] }),
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
    stop: () => void server.stop(true),
  }
}

// ---------- Requests ----------

export async function api(server: RunningServer, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const response = await fetch(`${server.url}${path}`, init)
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : undefined }
}

export type CollabResult = { status: 'synced' } | { status: 'denied'; reason: string } | { status: 'timeout' }

/**
 * Opens a document with the real Hocuspocus provider, as the editor does (no token set),
 * sending `headers` on the WebSocket upgrade.
 */
export async function openDocument(url: string, name: string, headers: Record<string, string>): Promise<CollabResult> {
  class WebSocketWithHeaders extends WebSocket {
    constructor(target: string | URL) {
      super(target, { headers } as unknown as string[])
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: WebSocketWithHeaders })
  let provider: HocuspocusProvider | undefined
  const result = await new Promise<CollabResult>((done) => {
    const timer = setTimeout(() => done({ status: 'timeout' }), 5000)
    provider = new HocuspocusProvider({
      websocketProvider: socket,
      name,
      document: new Y.Doc(),
      onSynced: () => {
        clearTimeout(timer)
        done({ status: 'synced' })
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer)
        done({ status: 'denied', reason })
      },
    })
    provider.attach()
  })
  provider?.destroy()
  socket.destroy()
  return result
}
