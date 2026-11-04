/** Dev mode (`vite`) end to end: identity from the cookie, Origin checks and port clashes. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:net'
import { api, DEV_PORTS, exitCodeWithin, openDocument, spawnServer, startServer, type RunningServer } from './helpers.ts'

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
