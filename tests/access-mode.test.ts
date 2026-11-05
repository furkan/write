/**
 * Access mode (`vite preview` after a build) end to end, with a local JWKS standing in for
 * Cloudflare Access (`WRITE_ACCESS_CERTS_URL`) and tokens signed by the test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  api,
  AUD,
  buildClient,
  connectDocument,
  exitCodeWithin,
  openDocument,
  PREVIEW_PORTS,
  readText,
  spawnServer,
  startAccessKeys,
  startServer,
  TEAM_DOMAIN,
  typeParagraph,
  writeV1Fixture,
  type AccessKeys,
  type RunningServer,
  type V1Fixture,
} from './helpers.ts'

let outDir: string
beforeAll(async () => {
  outDir = await buildClient()
}, 60_000)
afterAll(() => rm(outDir, { recursive: true, force: true }))

describe('Access mode', () => {
  let keys: AccessKeys
  let server: RunningServer
  let origin: string
  const jwt = (token: string) => ({ 'cf-access-jwt-assertion': token })

  beforeAll(async () => {
    keys = await startAccessKeys()
    server = await startServer({
      command: 'preview',
      ...PREVIEW_PORTS,
      outDir,
      env: {
        WRITE_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
        WRITE_ACCESS_AUD: AUD,
        WRITE_ACCESS_CERTS_URL: keys.certsUrl,
        // Must be ignored in Access mode.
        WRITE_DEV_USER: 'devuser@example.com',
      },
    })
    origin = server.url
  }, 30_000)
  afterAll(async () => {
    await server?.stop()
    keys?.stop()
  })

  test('logs one line naming the auth mode', () => {
    expect(server.output()).toContain(`[write] Access mode: every request needs a Cloudflare Access JWT for team ${TEAM_DOMAIN}`)
  })

  test('serves the built app', async () => {
    const response = await fetch(`${server.url}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root">')
  })

  test('a valid token identifies the user by email, lowercased and trimmed', async () => {
    const token = await keys.sign({ email: '  Alice@Example.COM ' })
    expect(await api(server, '/api/me', { headers: jwt(token) })).toEqual({
      status: 200,
      body: { email: 'alice@example.com', mode: 'access' },
    })
    expect((await api(server, '/api/docs', { headers: jwt(token) })).status).toBe(200)
  })

  test('no token, or a bad one, is 401 on every API route', async () => {
    const now = Math.floor(Date.now() / 1000)
    const cases: Record<string, Record<string, string>> = {
      missing: {},
      'dev cookie': { cookie: 'write-dev-user=alice@example.com' },
      'wrong aud': jwt(await keys.sign({ aud: ['some-other-app'] })),
      'wrong iss': jwt(await keys.sign({ iss: 'https://evil.cloudflareaccess.com' })),
      expired: jwt(await keys.sign({ iat: now - 7200, exp: now - 3600 })),
      'unknown key': jwt(await keys.sign({}, { key: keys.otherKey, kid: 'not-in-jwks' })),
      'wrong signature': jwt(await keys.sign({}, { key: keys.otherKey })),
    }
    for (const [name, headers] of Object.entries(cases)) {
      for (const path of ['/api/me', '/api/docs', '/api/trash', '/api/docs/abc/status', '/api/nope']) {
        const response = await api(server, path, { headers })
        expect({ name, path, status: response.status }).toEqual({ name, path, status: 401 })
      }
    }
    expect(server.output()).toMatch(/"audit":"auth_fail".*"reason":"ERR_JWT_EXPIRED"/)
  })

  test('a token without an email (a service token) is 403', async () => {
    const token = await keys.sign({ email: undefined, common_name: 'abc.access' })
    expect((await api(server, '/api/me', { headers: jwt(token) })).status).toBe(403)
    expect(server.output()).toContain('"common_name":"abc.access"')
  })

  test('mutating requests need a same-origin Origin even with a valid token', async () => {
    const token = await keys.sign()
    const evil = await api(server, '/api/docs', { method: 'POST', headers: { ...jwt(token), origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)
    const none = await api(server, '/api/docs', { method: 'POST', headers: jwt(token) })
    expect(none.status).toBe(403)
    const ok = await api(server, '/api/docs', { method: 'POST', headers: { ...jwt(token), origin } })
    expect(ok.status).toBe(201)
  })

  test('sharing between Access users: role by verified email, 404 for a stranger', async () => {
    const alice = { ...jwt(await keys.sign()), origin }
    const bob = { ...jwt(await keys.sign({ email: 'Bob@Example.com' })), origin }
    const mallory = { ...jwt(await keys.sign({ email: 'mallory@example.com' })), origin }
    const { body } = await api(server, '/api/docs', { method: 'POST', headers: alice })
    const id = String(body?.id)
    expect(body).toMatchObject({ owner: 'alice@example.com', role: 'owner', shares: {} })

    const shared = await api(server, `/api/docs/${id}/shares/bob%40example.com`, {
      method: 'PUT',
      headers: { ...alice, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(shared.body?.shares).toEqual({ 'bob@example.com': 'viewer' })
    expect((await api(server, `/api/docs/${id}/status`, { headers: bob })).body?.access).toBe('viewer')
    expect((await api(server, `/api/docs/${id}`, { headers: mallory })).status).toBe(404)
    // A share can't be forged with the dev cookie in Access mode.
    expect((await api(server, `/api/docs/${id}`, { headers: { cookie: 'write-dev-user=alice@example.com' } })).status).toBe(401)

    const url = `ws://127.0.0.1:${server.port}/collab`
    expect(await openDocument(url, id, bob)).toEqual({ status: 'synced' })
    expect(await openDocument(url, id, mallory)).toEqual({ status: 'denied', reason: 'permission-denied' })
    expect(await openDocument(url, 'never-created', alice)).toEqual({ status: 'denied', reason: 'permission-denied' })
  })

  describe('collaboration socket', () => {
    let id: string
    beforeAll(async () => {
      const token = await keys.sign()
      const { body } = await api(server, '/api/docs', { method: 'POST', headers: { ...jwt(token), origin } })
      id = String(body?.id)
    })

    test('syncs through the Vite proxy with a valid token', async () => {
      const token = await keys.sign()
      expect(await openDocument(`ws://127.0.0.1:${server.port}/collab`, id, { ...jwt(token), origin })).toEqual({
        status: 'synced',
      })
    })

    test('is refused without a valid token', async () => {
      const url = `ws://127.0.0.1:${server.port}/collab`
      expect(await openDocument(url, id, { origin })).toEqual({ status: 'denied', reason: 'unauthenticated' })
      const expired = await keys.sign({ exp: Math.floor(Date.now() / 1000) - 60 })
      expect(await openDocument(url, id, { ...jwt(expired), origin })).toEqual({
        status: 'denied',
        reason: 'unauthenticated',
      })
      expect(server.output()).toMatch(/"audit":"auth_fail".*"via":"collab"/)
    })

    test('is refused from another origin even with a valid token', async () => {
      const token = await keys.sign()
      expect(
        await openDocument(`ws://127.0.0.1:${server.port}/collab`, id, { ...jwt(token), origin: 'https://evil.example' }),
      ).toEqual({ status: 'denied', reason: 'permission-denied' })
    })

    test('Hocuspocus checks the token itself when reached directly on 127.0.0.1', async () => {
      const direct = `ws://127.0.0.1:${server.collabPort}`
      const directOrigin = `http://127.0.0.1:${server.collabPort}`
      expect(await openDocument(direct, id, { origin: directOrigin })).toEqual({
        status: 'denied',
        reason: 'unauthenticated',
      })
      const token = await keys.sign()
      expect(await openDocument(direct, id, { ...jwt(token), origin: directOrigin })).toEqual({ status: 'synced' })
    })
  })
})

describe('Access mode migration', () => {
  let keys: AccessKeys
  beforeAll(async () => {
    keys = await startAccessKeys()
  })
  afterAll(() => keys?.stop())
  const env = () => ({
    WRITE_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    WRITE_ACCESS_AUD: AUD,
    WRITE_ACCESS_CERTS_URL: keys.certsUrl,
  })

  test('refuses to start without WRITE_OWNER_EMAIL when documents have no owner', async () => {
    let dataDir = ''
    let fixture: V1Fixture | undefined
    const server = await spawnServer({
      command: 'preview',
      ...PREVIEW_PORTS,
      outDir,
      // Must not stand in for the Legacy owner in Access mode.
      env: { ...env(), WRITE_DEV_USER: 'devuser@example.com' },
      seed: async (dir) => {
        dataDir = dir
        fixture = await writeV1Fixture(dir)
      },
    })
    const code = await Promise.race([server.exited, Bun.sleep(15_000).then(() => 'timeout' as const)])
    try {
      expect(code).not.toBe('timeout')
      expect(code).not.toBe(0)
      expect(server.output()).toContain('2 document(s) without an owner')
      expect(server.output()).toContain('WRITE_OWNER_EMAIL')
      expect(server.output()).not.toContain('Local:')
      // Nothing was changed or backed up.
      expect(await readFile(join(dataDir, 'index.json'), 'utf8')).toBe(String(fixture?.indexText))
      expect(await readdir(server.backupDir).catch(() => [])).toEqual([])
    } finally {
      await exitCodeWithin(server, 1000)
    }
  }, 20_000)

  test('starts without WRITE_OWNER_EMAIL when no document lacks an owner', async () => {
    const server = await startServer({
      command: 'preview',
      ...PREVIEW_PORTS,
      outDir,
      env: env(),
      seed: async (dir) => void (await writeV1Fixture(dir, { docs: false })),
    })
    try {
      const token = await keys.sign()
      expect((await api(server, '/api/docs', { headers: { 'cf-access-jwt-assertion': token } })).body?.docs).toEqual([])
      const index = JSON.parse(await readFile(join(server.dataDir, 'index.json'), 'utf8')) as { version: number }
      expect(index.version).toBe(2)
    } finally {
      await server.stop()
    }
  }, 30_000)

  test('with WRITE_OWNER_EMAIL, the Legacy owner gets every ownerless document', async () => {
    const server = await startServer({
      command: 'preview',
      ...PREVIEW_PORTS,
      outDir,
      env: { ...env(), WRITE_OWNER_EMAIL: 'Alice@Example.com' },
      seed: async (dir) => void (await writeV1Fixture(dir)),
    })
    try {
      const alice = { 'cf-access-jwt-assertion': await keys.sign() }
      const bob = { 'cf-access-jwt-assertion': await keys.sign({ email: 'bob@example.com' }) }
      const list = (await api(server, '/api/docs', { headers: alice })).body?.docs as { id: string; owner: string }[]
      expect(list.map((doc) => [doc.id, doc.owner])).toEqual([['legacy-one', 'alice@example.com']])
      expect((await api(server, '/api/docs', { headers: bob })).body?.docs).toEqual([])
      expect(await readdir(server.backupDir)).toHaveLength(1)
      expect(server.output()).toContain('"audit":"migration"')
    } finally {
      await server.stop()
    }
  }, 30_000)
})

describe('Access mode without its settings', () => {
  test.each([
    ['neither variable', {}],
    ['only the team domain', { WRITE_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN }],
    ['only the AUD', { WRITE_ACCESS_AUD: AUD }],
  ])('refuses to start with %s', async (_name, env: Record<string, string>) => {
    const server = await spawnServer({ command: 'preview', ...PREVIEW_PORTS, outDir, env })
    const code = await exitCodeWithin(server)
    expect(code).not.toBe('timeout')
    expect(code).not.toBe(0)
    expect(server.output()).toContain('needs WRITE_ACCESS_TEAM_DOMAIN and WRITE_ACCESS_AUD')
    // Nothing was served in the meantime.
    expect(server.output()).not.toContain('Local:')
  }, 20_000)
})

describe('Access mode while the signing keys are unavailable', () => {
  let keys: AccessKeys
  let server: RunningServer
  beforeAll(async () => {
    keys = await startAccessKeys()
    // Down from the start, so the server has no cached keys: like a cache that expired (after
    // 10 minutes) during a Cloudflare blip.
    keys.setAvailable(false)
    server = await startServer({
      command: 'preview',
      ...PREVIEW_PORTS,
      outDir,
      env: { WRITE_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, WRITE_ACCESS_AUD: AUD, WRITE_ACCESS_CERTS_URL: keys.certsUrl },
      seed: async (dir) => {
        const now = Date.now()
        const entry = { title: 'A', preview: '', words: 0, createdAt: now, updatedAt: now, owner: 'alice@example.com', shares: {} }
        await writeFile(join(dir, 'index.json'), JSON.stringify({ version: 2, docs: { 'doc-a': entry }, deleted: {} }))
      },
    })
  }, 30_000)
  afterAll(async () => {
    await server?.stop()
    keys?.stop()
  })

  test('a refused collaboration connection is closed, retries, and syncs once the keys are back', async () => {
    const headers = { 'cf-access-jwt-assertion': await keys.sign(), origin: server.url }
    const ws = `ws://127.0.0.1:${server.port}/collab`
    expect((await api(server, '/api/me', { headers })).status).toBe(503)
    const live = await connectDocument(ws, 'doc-a', headers)
    try {
      // Not left open with the document refused (the provider would never ask again): closed, so
      // the client reconnects and is checked again.
      await live.waitFor(/^close$/)
      expect(live.events).not.toContain('synced')
      keys.setAvailable(true)
      await live.waitFor(/^synced$/, { ms: 10_000 })
      typeParagraph(live.doc, 'typed once the keys were back')
      await Bun.sleep(1000)
      expect(await readText(ws, 'doc-a', headers)).toContain('typed once the keys were back')
      expect(server.output()).toContain('"reason":"signing keys unavailable"')
      // Closing before refusing doesn't make Hocuspocus log anything.
      expect(server.output()).not.toContain('Error')
    } finally {
      live.destroy()
    }
  }, 30_000)
})
