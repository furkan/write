/**
 * Access mode (`vite preview` after a build) end to end, with a local JWKS standing in for
 * Cloudflare Access (`WRITE_ACCESS_CERTS_URL`) and tokens signed by the test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import {
  api,
  AUD,
  buildClient,
  exitCodeWithin,
  openDocument,
  PREVIEW_PORTS,
  spawnServer,
  startAccessKeys,
  startServer,
  TEAM_DOMAIN,
  type AccessKeys,
  type RunningServer,
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
