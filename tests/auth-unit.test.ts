/** Unit tests for configuration and identity, without starting a server. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createAuthenticator, isAllowedOrigin, type HeaderGetter } from '../server/auth.ts'
import { ConfigError, describeConfig, resolveConfig } from '../server/config.ts'
import { AUD, startAccessKeys, TEAM_DOMAIN, type AccessKeys } from './helpers.ts'

const ROOT = '/srv/write'
const headers =
  (values: Record<string, string>): HeaderGetter =>
  (name) =>
    values[name]

describe('resolveConfig', () => {
  test('Dev mode defaults', () => {
    const config = resolveConfig('dev', {}, ROOT)
    expect(config).toEqual({
      auth: { mode: 'dev', devUser: 'dev@localhost' },
      host: '0.0.0.0',
      port: 5173,
      collabPort: 1234,
      dataDir: '/srv/write/.collab-data',
      backupDir: '/srv/write/.collab-backups',
      allowedHosts: [],
      allowedOrigins: [],
      ownerEmail: 'dev@localhost',
      pdf: { chromium: undefined, maxConcurrent: 2, maxQueue: 8, timeoutMs: 30_000, maxBytes: 5 * 1024 * 1024 },
    })
  })

  test('PDF settings', () => {
    const config = resolveConfig(
      'dev',
      {
        WRITE_PDF_CHROMIUM: 'chrome/headless-shell',
        WRITE_PDF_MAX_CONCURRENT: '1',
        WRITE_PDF_MAX_QUEUE: '0',
        WRITE_PDF_TIMEOUT_SECONDS: '5',
        WRITE_PDF_MAX_MB: '0.5',
      },
      ROOT,
    )
    expect(config.pdf).toEqual({
      chromium: '/srv/write/chrome/headless-shell',
      maxConcurrent: 1,
      maxQueue: 0,
      timeoutMs: 5000,
      maxBytes: 512 * 1024,
    })
    expect(() => resolveConfig('dev', { WRITE_PDF_MAX_CONCURRENT: '0' }, ROOT)).toThrow('WRITE_PDF_MAX_CONCURRENT must be')
    expect(() => resolveConfig('dev', { WRITE_PDF_TIMEOUT_SECONDS: 'soon' }, ROOT)).toThrow('WRITE_PDF_TIMEOUT_SECONDS must be')
  })

  test('Access mode defaults bind to loopback and derive the certs URL', () => {
    const config = resolveConfig(
      'access',
      { WRITE_ACCESS_TEAM_DOMAIN: 'https://Acme.cloudflareaccess.com/', WRITE_ACCESS_AUD: 'aud1' },
      ROOT,
    )
    expect(config.auth).toEqual({
      mode: 'access',
      teamDomain: 'acme.cloudflareaccess.com',
      aud: 'aud1',
      certsUrl: 'https://acme.cloudflareaccess.com/cdn-cgi/access/certs',
    })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4173)
    expect(config.ownerEmail).toBeUndefined()
  })

  test('reads every WRITE_* variable', () => {
    const config = resolveConfig(
      'access',
      {
        WRITE_HOST: '127.0.0.2',
        WRITE_PORT: '4180',
        WRITE_COLLAB_PORT: '1241',
        WRITE_DATA_DIR: 'pilot-data',
        WRITE_BACKUP_DIR: '/backups/write',
        WRITE_ALLOWED_HOSTS: 'write.example.com, other.example.com',
        WRITE_ALLOWED_ORIGINS: 'https://write.example.com/',
        WRITE_ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com',
        WRITE_ACCESS_AUD: 'aud1',
        WRITE_ACCESS_CERTS_URL: 'http://127.0.0.1:9999/certs',
        WRITE_OWNER_EMAIL: ' Owner@Example.com ',
        WRITE_DEV_USER: 'ignored@example.com',
      },
      ROOT,
    )
    expect(config).toMatchObject({
      host: '127.0.0.2',
      port: 4180,
      collabPort: 1241,
      dataDir: '/srv/write/pilot-data',
      backupDir: '/backups/write',
      allowedHosts: ['write.example.com', 'other.example.com'],
      allowedOrigins: ['https://write.example.com'],
      ownerEmail: 'owner@example.com',
    })
    expect(config.auth).toMatchObject({ certsUrl: 'http://127.0.0.1:9999/certs' })
  })

  test('WRITE_ACCESS_CERTS_URL must be https, or http on loopback', () => {
    const access = { WRITE_ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com', WRITE_ACCESS_AUD: 'aud1' }
    for (const url of ['http://keys.example.com/certs', 'http://10.0.0.5/certs', 'ftp://127.0.0.1/certs', 'file:///etc/keys']) {
      expect(() => resolveConfig('access', { ...access, WRITE_ACCESS_CERTS_URL: url }, ROOT)).toThrow(ConfigError)
    }
    for (const url of ['https://keys.example.com/certs', 'http://127.0.0.1:9999/certs', 'http://localhost:1/certs', 'http://[::1]:1/certs']) {
      expect(resolveConfig('access', { ...access, WRITE_ACCESS_CERTS_URL: url }, ROOT).auth).toMatchObject({ certsUrl: url })
    }
  })

  test('the startup line warns when the signing keys are not Cloudflare\'s', () => {
    const access = { WRITE_ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com', WRITE_ACCESS_AUD: 'aud1' }
    expect(describeConfig(resolveConfig('access', access, ROOT))).not.toContain('WARNING')
    const custom = describeConfig(resolveConfig('access', { ...access, WRITE_ACCESS_CERTS_URL: 'http://127.0.0.1:9999/certs' }, ROOT))
    expect(custom).toContain('WARNING: signing keys from http://127.0.0.1:9999/certs (WRITE_ACCESS_CERTS_URL)')
  })

  test('Access mode refuses to start without both Access variables', () => {
    expect(() => resolveConfig('access', {}, ROOT)).toThrow(ConfigError)
    expect(() => resolveConfig('access', { WRITE_ACCESS_TEAM_DOMAIN: 'a.cloudflareaccess.com' }, ROOT)).toThrow(
      /missing: WRITE_ACCESS_AUD/,
    )
    // Dev settings never stand in for Access ones.
    expect(() => resolveConfig('access', { WRITE_DEV_USER: 'x@example.com' }, ROOT)).toThrow(ConfigError)
  })

  test('rejects malformed values', () => {
    expect(() => resolveConfig('dev', { WRITE_COLLAB_PORT: 'abc' }, ROOT)).toThrow(/WRITE_COLLAB_PORT/)
    expect(() => resolveConfig('dev', { WRITE_PORT: '70000' }, ROOT)).toThrow(/WRITE_PORT/)
    expect(() => resolveConfig('dev', { WRITE_ALLOWED_ORIGINS: 'write.example.com' }, ROOT)).toThrow(
      /WRITE_ALLOWED_ORIGINS/,
    )
  })

  test('WRITE_DEV_USER is normalized and becomes the default owner in Dev mode', () => {
    const config = resolveConfig('dev', { WRITE_DEV_USER: ' Bob@Example.COM ' }, ROOT)
    expect(config.auth).toEqual({ mode: 'dev', devUser: 'bob@example.com' })
    expect(config.ownerEmail).toBe('bob@example.com')
  })
})

describe('Dev mode identity', () => {
  const dev = createAuthenticator({ mode: 'dev', devUser: 'devuser@example.com' })

  test('the write-dev-user cookie wins, normalized', async () => {
    const identity = await dev.identify(headers({ cookie: 'a=1; write-dev-user=%20Carol%40Example.com; b=2' }))
    expect(identity).toEqual({ ok: true, user: { email: 'carol@example.com' } })
  })

  test('falls back to the configured dev user', async () => {
    expect(await dev.identify(headers({}))).toEqual({ ok: true, user: { email: 'devuser@example.com' } })
    expect(await dev.identify(headers({ cookie: 'write-dev-user=' }))).toEqual({
      ok: true,
      user: { email: 'devuser@example.com' },
    })
    expect(await dev.identify(headers({ cookie: 'write-dev-user=%E0' }))).toEqual({
      ok: true,
      user: { email: 'devuser@example.com' },
    })
  })

  test('ignores the Access header', async () => {
    const identity = await dev.identify(headers({ 'cf-access-jwt-assertion': 'x' }))
    expect(identity).toEqual({ ok: true, user: { email: 'devuser@example.com' } })
  })
})

describe('Access mode identity', () => {
  let keys: AccessKeys
  let access: ReturnType<typeof createAuthenticator>
  beforeAll(async () => {
    keys = await startAccessKeys()
    access = createAuthenticator({ mode: 'access', teamDomain: TEAM_DOMAIN, aud: AUD, certsUrl: keys.certsUrl })
  })
  afterAll(() => keys.stop())

  const withToken = (token: string) => headers({ 'cf-access-jwt-assertion': token })

  test('a valid token gives its email, trimmed and lowercased', async () => {
    const token = await keys.sign({ email: ' Alice@Example.COM ' })
    expect(await access.identify(withToken(token))).toEqual({ ok: true, user: { email: 'alice@example.com' } })
  })

  test('the dev cookie means nothing', async () => {
    expect(await access.identify(headers({ cookie: 'write-dev-user=alice@example.com' }))).toMatchObject({
      ok: false,
      status: 401,
    })
  })

  test('a token without an email is 403', async () => {
    const token = await keys.sign({ email: undefined, common_name: 'svc.access' })
    expect(await access.identify(withToken(token))).toMatchObject({ ok: false, status: 403 })
  })

  test('a token for another app or team, expired or signed by another key is 401', async () => {
    const bad = [
      await keys.sign({ aud: ['another-app'] }),
      await keys.sign({ iss: 'https://evil.cloudflareaccess.com' }),
      await keys.sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
      await keys.sign({}, { key: keys.otherKey }),
      await keys.sign({}, { key: keys.otherKey, kid: 'unknown-kid' }),
      'not-a-jwt',
    ]
    for (const token of bad) {
      expect(await access.identify(withToken(token))).toMatchObject({ ok: false, status: 401 })
    }
  })

  test('unreachable signing keys are 503, not 401', async () => {
    const offline = createAuthenticator({
      mode: 'access',
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      certsUrl: 'http://127.0.0.1:9/certs',
    })
    const token = await keys.sign()
    expect(await offline.identify(withToken(token))).toMatchObject({ ok: false, status: 503 })
  })

  test.each([
    ['502 Bad Gateway', () => new Response('<html>bad gateway</html>', { status: 502 })],
    ['200 with an HTML page', () => new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } })],
    ['200 with no keys', () => Response.json({ nope: true })],
  ])('signing keys answering %s are 503 and logged', async (_name, answer) => {
    const broken = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: answer })
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => void errors.push(args.join(' '))
    try {
      const authenticator = createAuthenticator({
        mode: 'access',
        teamDomain: TEAM_DOMAIN,
        aud: AUD,
        certsUrl: `http://127.0.0.1:${broken.port}/certs`,
      })
      expect(await authenticator.identify(withToken(await keys.sign()))).toMatchObject({
        ok: false,
        status: 503,
        reason: 'signing keys unavailable',
      })
      expect(String(errors[0])).toContain(`could not use the Cloudflare Access signing keys from http://127.0.0.1:${broken.port}/certs`)
    } finally {
      console.error = original
      void broken.stop(true)
    }
  })
})

describe('isAllowedOrigin', () => {
  test('same host, any scheme the browser used', () => {
    expect(isAllowedOrigin(headers({ origin: 'https://write.example.com', host: 'write.example.com' }), [])).toBe(true)
    expect(isAllowedOrigin(headers({ origin: 'http://127.0.0.1:5180', host: '127.0.0.1:5180' }), [])).toBe(true)
  })

  test('other hosts, ports, missing or opaque origins are refused', () => {
    expect(isAllowedOrigin(headers({ origin: 'https://evil.example', host: 'write.example.com' }), [])).toBe(false)
    expect(isAllowedOrigin(headers({ origin: 'http://127.0.0.1:5181', host: '127.0.0.1:5180' }), [])).toBe(false)
    expect(isAllowedOrigin(headers({ host: 'write.example.com' }), [])).toBe(false)
    expect(isAllowedOrigin(headers({ origin: 'null', host: 'write.example.com' }), [])).toBe(false)
  })

  test('WRITE_ALLOWED_ORIGINS adds origins', () => {
    const header = headers({ origin: 'https://write.example.com', host: '127.0.0.1:4173' })
    expect(isAllowedOrigin(header, [])).toBe(false)
    expect(isAllowedOrigin(header, ['https://write.example.com'])).toBe(true)
  })
})
