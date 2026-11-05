/** Dev mode (`vite`) end to end: identity from the cookie, Origin checks and port clashes. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { watch, type FSWatcher } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  api,
  connectDocument,
  DEV_PORTS,
  exitCodeWithin,
  openDocument,
  readText,
  ROOT,
  spawnServer,
  startServer,
  typeParagraph,
  type RunningServer,
} from './helpers.ts'

describe('Dev mode', () => {
  let server: RunningServer
  let origin: string
  beforeAll(async () => {
    server = await startServer({ command: 'dev', ...DEV_PORTS, env: { WRITE_DEV_USER: 'Devuser@Example.com' } })
    origin = server.url
  }, 30_000)
  afterAll(() => server?.stop())

  test('logs one line naming the auth mode', () => {
    expect(server.output()).toContain('[write] Dev mode')
  })

  test('GET /api/me is WRITE_DEV_USER without a cookie', async () => {
    expect(await api(server, '/api/me')).toEqual({
      status: 200,
      body: { email: 'devuser@example.com', mode: 'dev' },
    })
  })

  test('the write-dev-user cookie picks the user', async () => {
    const response = await api(server, '/api/me', { headers: { cookie: 'write-dev-user=Bob%40Example.com' } })
    expect(response.body).toEqual({ email: 'bob@example.com', mode: 'dev' })
  })

  test('mutating requests need a same-origin Origin', async () => {
    const created = await api(server, '/api/docs', { method: 'POST', headers: { origin } })
    expect(created.status).toBe(201)

    for (const headers of [{ origin: 'http://evil.example' }, {} as Record<string, string>]) {
      const refused = await api(server, '/api/docs', { method: 'POST', headers })
      expect(refused.status).toBe(403)
    }
    expect(server.output()).toContain('"audit":"auth_fail"')
    // Reads don't need Origin.
    expect((await api(server, '/api/docs')).status).toBe(200)
  })

  test('unknown API paths are a JSON 404', async () => {
    expect(await api(server, '/api/nope')).toEqual({ status: 404, body: { error: 'not found' } })
  })

  test('the collab socket syncs with a same-origin Origin, and refuses others', async () => {
    const { body } = await api(server, '/api/docs', { method: 'POST', headers: { origin } })
    const id = String(body?.id)
    const collab = `ws://127.0.0.1:${server.port}/collab`
    expect(await openDocument(collab, id, { origin })).toEqual({ status: 'synced' })
    expect(await openDocument(collab, id, { origin: 'http://evil.example' })).toEqual({
      status: 'denied',
      reason: 'permission-denied',
    })
    // Straight to Hocuspocus, skipping Vite: the same checks apply.
    expect(await openDocument(`ws://127.0.0.1:${server.collabPort}`, id, {})).toEqual({
      status: 'denied',
      reason: 'permission-denied',
    })
  })
})

describe('Dev mode restarts', () => {
  let server: RunningServer
  // What changes in the checkout itself while these tests run: they restart their server by
  // touching its config and writing an .env file, which must never reach a dev server running
  // from the checkout.
  const changed = new Set<string>()
  let watcher: FSWatcher
  beforeAll(async () => {
    watcher = watch(ROOT, (_event, name) => name && changed.add(name))
    server = await startServer({ command: 'dev', ...DEV_PORTS })
  }, 30_000)
  afterAll(async () => {
    watcher?.close()
    await server?.stop()
  })

  test('after vite.config.ts changes, the server comes back on the same ports and editing still syncs', async () => {
    const origin = server.url
    const ws = `ws://127.0.0.1:${server.port}/collab`
    const { body } = await api(server, '/api/docs', { method: 'POST', headers: { origin } })
    const id = String(body?.id)
    const editor = await connectDocument(ws, id, { origin })
    try {
      typeParagraph(editor.doc, 'typed before the restart')
      await Bun.sleep(300)
      const mark = editor.events.length

      // What Vite watches: touching the config makes it restart in-process. (The server's own
      // copy of the project, not the checkout.)
      const config = join(server.root, 'vite.config.ts')
      const now = new Date()
      await utimes(config, now, now)
      const deadline = Date.now() + 15_000
      while (!server.output().includes('server restarted') && Date.now() < deadline) await Bun.sleep(100)
      expect(server.output()).toContain('server restarted')
      expect(server.output()).not.toContain('already in use')
      expect(server.output()).not.toContain('did not restart')
      // The new collaboration server announced itself.
      expect(server.output().split('[write] Dev mode').length - 1).toBe(2)

      // The open tab reconnects to the new collaboration server and keeps syncing.
      await editor.waitFor(/^synced$/, { from: mark, ms: 10_000 })
      typeParagraph(editor.doc, 'typed after the restart')
      await Bun.sleep(1000)
      const text = await readText(ws, id, { origin })
      expect(text).toContain('typed before the restart')
      expect(text).toContain('typed after the restart')
      expect((await api(server, `/api/docs/${id}`)).body?.preview).toContain('typed before the restart')
    } finally {
      editor.destroy()
    }
  }, 40_000)

  test('a changed WRITE_* setting takes effect on the restart', async () => {
    // Vite restarts when an .env file changes; this one is only read by `vite dev`. In the
    // server's own copy of the project.
    const envFile = join(server.root, '.env.development.local')
    const restarts = () => server.output().split('server restarted').length - 1
    const before = restarts()
    try {
      await writeFile(envFile, 'WRITE_DEV_USER=after-restart@x.com\n')
      const deadline = Date.now() + 15_000
      while (restarts() === before && Date.now() < deadline) await Bun.sleep(100)
      expect(restarts()).toBe(before + 1)
      expect((await api(server, '/api/me')).body).toEqual({ email: 'after-restart@x.com', mode: 'dev' })
    } finally {
      await rm(envFile, { force: true })
    }
  }, 30_000)

  test('they never touch the checkout', () => {
    expect(server.root).not.toBe(ROOT)
    expect([...changed].filter((name) => name === 'vite.config.ts' || name.startsWith('.env'))).toEqual([])
  })
})

describe('Dev mode with a busy collaboration port', () => {
  let blocker: Server
  beforeAll(async () => {
    blocker = createServer()
    await new Promise<void>((done) => blocker.listen(DEV_PORTS.collabPort, '127.0.0.1', done))
  })
  afterAll(() => new Promise<void>((done) => blocker.close(() => done())))

  test('refuses to start and names WRITE_COLLAB_PORT', async () => {
    const server = await spawnServer({ command: 'dev', ...DEV_PORTS })
    const code = await exitCodeWithin(server)
    expect(code).not.toBe('timeout')
    expect(code).not.toBe(0)
    expect(server.output()).toContain(`127.0.0.1:${DEV_PORTS.collabPort} is already in use`)
    expect(server.output()).toContain('WRITE_COLLAB_PORT')
  }, 20_000)
})
