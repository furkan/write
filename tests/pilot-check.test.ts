/** `bun run pilot:check`: the pilot's env file and checkout, without starting a server. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { checkPilotEnv, parseEnvironmentFile } from '../deploy/pilot-check.ts'
import { SETTINGS } from '../server/config.ts'
import { ROOT, tempDir } from './helpers.ts'

let root: string

const GOOD = {
  WRITE_HOST: '127.0.0.1',
  WRITE_PORT: '4174',
  WRITE_COLLAB_PORT: '1235',
  WRITE_DATA_DIR: '/var/lib/write-pilot/data',
  WRITE_BACKUP_DIR: '/var/lib/write-pilot/backups',
  WRITE_ALLOWED_HOSTS: 'write.example.com',
  WRITE_ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com',
  WRITE_ACCESS_AUD: 'abc123',
  WRITE_OWNER_EMAIL: 'owner@example.com',
  WRITE_PDF_CHROMIUM: '/opt/write-pilot-chromium/chrome-headless-shell',
}

const file = (env: Record<string, string | undefined>) =>
  Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

const writable = () => 'writable' as const
const executable = () => true

const check = (env: Record<string, string | undefined>, options: Partial<Parameters<typeof checkPilotEnv>[1]> = {}) =>
  checkPilotEnv(file(env), { root, writable, executable, ...options })

const errors = (result: ReturnType<typeof checkPilotEnv>) =>
  result.findings.filter((finding) => finding.level === 'error').map((finding) => finding.message)
const warnings = (result: ReturnType<typeof checkPilotEnv>) =>
  result.findings.filter((finding) => finding.level === 'warning').map((finding) => finding.message)

beforeAll(async () => {
  // A checkout with a build in it.
  root = await tempDir('pilot-check-')
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>')
  await mkdir(join(root, 'node_modules', '.vite-temp'), { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('parseEnvironmentFile', () => {
  test('reads systemd EnvironmentFile= lines', () => {
    const { env, invalid } = parseEnvironmentFile('# comment\n; also a comment\n\nA=1\nB = 2\nC="quoted value"\nD=\'single\'\nexport E=5\nnonsense\n')
    expect(env).toEqual({ A: '1', C: 'quoted value', D: 'single' })
    expect(invalid).toHaveLength(3)
    expect(invalid.join('\n')).toContain('does not accept `export`')
  })
})

describe('checkPilotEnv', () => {
  test('a complete pilot env passes and names the startup line', () => {
    const result = check(GOOD)
    expect(result.findings).toEqual([])
    expect(result.startupLine).toContain('[write] Access mode')
    expect(result.startupLine).toContain('collaboration on 127.0.0.1:1235')
  })

  test('deploy/pilot.env.example still has placeholders, and is otherwise complete', () => {
    const result = checkPilotEnv(readFileSync(join(ROOT, 'deploy', 'pilot.env.example'), 'utf8'), { root, writable, executable })
    const messages = errors(result)
    expect(messages.every((message) => message.includes('placeholder'))).toBe(true)
    expect(messages.map((message) => message.split(' ')[0]).sort()).toEqual([
      'WRITE_ACCESS_AUD',
      'WRITE_ACCESS_TEAM_DOMAIN',
      'WRITE_ALLOWED_HOSTS',
      'WRITE_OWNER_EMAIL',
    ])
  })

  test('every required variable is reported when missing', () => {
    for (const name of Object.keys(GOOD)) {
      expect(errors(check({ ...GOOD, [name]: undefined }))).toContain(`${name} is not set.`)
    }
  })

  test('ports may not clash with the dev server or each other', () => {
    expect(errors(check({ ...GOOD, WRITE_COLLAB_PORT: '1234' })).join()).toContain("dev server's collaboration port")
    expect(errors(check({ ...GOOD, WRITE_PORT: '5173' })).join()).toContain("dev server's port")
    expect(errors(check({ ...GOOD, WRITE_PORT: '1235' })).join()).toContain('same port')
    expect(errors(check({ ...GOOD, WRITE_PORT: 'eighty' })).join()).toContain('WRITE_PORT must be a port number')
  })

  test('settings that bypass or weaken Access are errors', () => {
    expect(errors(check({ ...GOOD, WRITE_HOST: '0.0.0.0' })).join()).toContain('must bind to 127.0.0.1')
    expect(errors(check({ ...GOOD, WRITE_ACCESS_CERTS_URL: 'https://keys.example.com/certs' })).join()).toContain(
      'WRITE_ACCESS_CERTS_URL is set',
    )
    expect(errors(check({ ...GOOD, WRITE_ACCESS_TEAM_DOMAIN: 'not a domain' })).join()).toContain('WRITE_ACCESS_TEAM_DOMAIN must be')
    expect(errors(check({ ...GOOD, WRITE_OWNER_EMAIL: 'nobody' })).join()).toContain('not an email address')
  })

  test('unneeded or unknown settings are warnings', () => {
    const result = check({ ...GOOD, WRITE_ALLOWED_ORIGINS: 'https://write.example.com', WRITE_DEV_USER: 'x@y.z', WRITE_COLAB_PORT: '1' })
    expect(errors(result)).toEqual([])
    expect(warnings(result).join('\n')).toContain('WRITE_ALLOWED_ORIGINS is set')
    expect(warnings(result).join('\n')).toContain('WRITE_DEV_USER is set')
    expect(warnings(result).join('\n')).toContain('WRITE_COLAB_PORT is not a Write setting')
  })

  test('knows, and .env.example documents, every setting the server reads', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8')
    for (const name of SETTINGS) {
      expect(warnings(check({ ...GOOD, [name]: GOOD[name as keyof typeof GOOD] ?? 'x' })).join()).not.toContain(`${name} is not`)
      expect(example).toContain(`${name}=`)
    }
  })

  test('data and backup dirs: absolute, writable, apart, outside the checkout', () => {
    expect(errors(check({ ...GOOD, WRITE_DATA_DIR: 'data' })).join()).toContain('WRITE_DATA_DIR must be an absolute path')
    expect(errors(check({ ...GOOD, WRITE_BACKUP_DIR: GOOD.WRITE_DATA_DIR })).join()).toContain('same directory')
    expect(errors(check(GOOD, { writable: () => 'read-only' })).join()).toContain('is not writable by this user')
    const missing = check(GOOD, { writable: (path) => (path === '/' || path === '/var' ? 'read-only' : 'missing') })
    expect(errors(missing)).toEqual([])
    expect(warnings(missing).join()).toContain('does not exist yet')
    expect(warnings(check({ ...GOOD, WRITE_DATA_DIR: join(root, 'data') })).join()).toContain('inside the checkout')
  })

  test('Chromium for Download as PDF: an executable outside /home', () => {
    expect(errors(check(GOOD, { executable: () => false })).join()).toContain(
      'WRITE_PDF_CHROMIUM /opt/write-pilot-chromium/chrome-headless-shell is not an executable this user can run',
    )
    expect(errors(check({ ...GOOD, WRITE_PDF_CHROMIUM: '/home/me/.cache/ms-playwright/chrome' })).join()).toContain(
      'is under /home, which the unit hides',
    )
    expect(errors(check({ ...GOOD, WRITE_PDF_MAX_QUEUE: 'lots' })).join()).toContain('WRITE_PDF_MAX_QUEUE must be a whole number')
    // The real check: /bin/sh is executable, a directory is not.
    expect(errors(checkPilotEnv(file({ ...GOOD, WRITE_PDF_CHROMIUM: '/bin/sh' }), { root, writable }))).toEqual([])
    expect(errors(checkPilotEnv(file({ ...GOOD, WRITE_PDF_CHROMIUM: '/opt' }), { root, writable })).join()).toContain(
      'is not an executable',
    )
  })

  test('the real filesystem check sees a writable temp dir', () => {
    const result = checkPilotEnv(file({ ...GOOD, WRITE_DATA_DIR: join(root, '..'), WRITE_BACKUP_DIR: '/proc' }), { root, executable })
    expect(errors(result)).toEqual(['WRITE_BACKUP_DIR /proc is not writable by this user.'])
  })

  test('the checkout needs a build and no .env files with WRITE_* settings', async () => {
    const bare = await tempDir('pilot-check-bare-')
    try {
      expect(errors(checkPilotEnv(file(GOOD), { root: bare, writable, executable })).join()).toContain('has no build')
      await mkdir(join(bare, 'dist'))
      await writeFile(join(bare, 'dist', 'index.html'), '')
      expect(errors(checkPilotEnv(file(GOOD), { root: bare, writable, executable })).join()).toContain('.vite-temp is missing')
      await mkdir(join(bare, 'node_modules', '.vite-temp'), { recursive: true })
      await writeFile(join(bare, '.env.local'), 'WRITE_ACCESS_CERTS_URL=http://127.0.0.1:9/certs\nOTHER=1\n')
      expect(errors(checkPilotEnv(file(GOOD), { root: bare, writable, executable }))).toEqual([
        `${join(bare, '.env.local')} sets WRITE_ACCESS_CERTS_URL; \`vite preview\` reads it too. Keep every setting in the env file and delete it.`,
      ])
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })
})

describe('bun run pilot:check', () => {
  test('exits 1 on errors and 0 on a good file', async () => {
    const dir = await tempDir('pilot-check-cli-')
    try {
      const run = (env: Record<string, string>) => {
        const path = join(dir, 'pilot.env')
        writeFileSync(path, file(env))
        return spawnSync('bun', ['run', 'pilot:check', path], { cwd: ROOT, encoding: 'utf8' })
      }
      const dirs = { WRITE_DATA_DIR: join(dir, 'data'), WRITE_BACKUP_DIR: join(dir, 'backups'), WRITE_PDF_CHROMIUM: '/bin/sh' }
      const bad = run({ ...GOOD, ...dirs, WRITE_COLLAB_PORT: '1234' })
      expect(bad.status).toBe(1)
      expect(bad.stdout).toContain("error    WRITE_COLLAB_PORT is 1234, the dev server's collaboration port")
      const usage = spawnSync('bun', ['run', 'pilot:check'], { cwd: ROOT, encoding: 'utf8' })
      expect(usage.status).toBe(2)
      // The worktree has a build only after `bun run build`; judge the env file, not the checkout.
      const good = run({ ...GOOD, ...dirs })
      const output = good.stdout
        .split('\n')
        .filter((line) => !/has no build|\.vite-temp is missing|error\(s\) in/.test(line))
      expect(output.join('\n')).not.toContain('error  ')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
