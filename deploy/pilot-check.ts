/**
 * `bun run pilot:check <env file>`: checks the pilot's env file (deploy/pilot.env.example) and its
 * checkout before the systemd unit starts it. Prints one line per finding and exits 1 if any is
 * an error. Run it as the service user, so "writable" means writable for the service:
 *
 *   sudo -u write-pilot /usr/local/bin/bun run pilot:check /etc/write-pilot/pilot.env
 */
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { isValidEmail } from '../server/roles.ts'
import { ConfigError, describeConfig, resolveConfig, SETTINGS, type Setting } from '../server/config.ts'

export type Finding = { level: 'error' | 'warning'; message: string }

/** Every WRITE_* variable the server reads (see .env.example). */
const KNOWN = new Set<string>(SETTINGS)

/** What the pilot must set, even where the server has a default. */
const REQUIRED: Setting[] = [
  'WRITE_HOST',
  'WRITE_PORT',
  'WRITE_COLLAB_PORT',
  'WRITE_DATA_DIR',
  'WRITE_BACKUP_DIR',
  'WRITE_ALLOWED_HOSTS',
  'WRITE_ACCESS_TEAM_DOMAIN',
  'WRITE_ACCESS_AUD',
  'WRITE_OWNER_EMAIL',
]

/** The ports of the dev server, which may run on the same machine. */
const DEV_PORT = 5173
const DEV_COLLAB_PORT = 1234

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/** `.env` files Vite also reads in the checkout (`loadEnv` for `vite preview`). */
const DOTENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local']

/**
 * Parses systemd's EnvironmentFile= format: `KEY=value` lines, `#` and `;` comments, optional
 * surrounding quotes. Lines systemd would reject or misread are reported in `invalid`.
 */
export function parseEnvironmentFile(text: string) {
  const env: Record<string, string> = {}
  const invalid: string[] = []
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) {
      invalid.push(`line ${index + 1}: "${line}" is not KEY=value${line.startsWith('export ') ? ' (systemd does not accept `export`)' : ''}`)
      continue
    }
    const [, key = '', rawValue = ''] = match
    const value = rawValue.trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    env[key] = quoted ? (quoted[2] ?? '') : value
  }
  return { env, invalid }
}

export type CheckOptions = {
  /** The pilot's checkout (where `bun run preview` runs). */
  root: string
  /** Whether `path` exists and the current user may write to it; overridable for tests. */
  writable?: (path: string) => 'writable' | 'read-only' | 'missing'
}

function defaultWritable(path: string): 'writable' | 'read-only' | 'missing' {
  if (!existsSync(path)) return 'missing'
  try {
    if (!statSync(path).isDirectory()) return 'read-only'
    accessSync(path, constants.W_OK)
    return 'writable'
  } catch {
    return 'read-only'
  }
}

/** Nearest existing ancestor of `path`. */
function existingParent(path: string, writable: NonNullable<CheckOptions['writable']>) {
  let current = dirname(path)
  while (writable(current) === 'missing' && dirname(current) !== current) current = dirname(current)
  return current
}

/** Checks an env file's text for the pilot. Returns every finding, and the startup line if it resolves. */
export function checkPilotEnv(text: string, { root, writable = defaultWritable }: CheckOptions) {
  const findings: Finding[] = []
  const error = (message: string) => findings.push({ level: 'error', message })
  const warning = (message: string) => findings.push({ level: 'warning', message })
  const { env, invalid } = parseEnvironmentFile(text)
  for (const line of invalid) error(line)

  for (const name of REQUIRED) if (!env[name]) error(`${name} is not set.`)
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('WRITE_') && !KNOWN.has(name)) warning(`${name} is not a Write setting (a typo?); it is ignored.`)
    if (/[<>]/.test(value)) error(`${name} still has a placeholder: ${value}`)
  }

  // Settings that would weaken or bypass Access.
  if (env.WRITE_HOST && !LOOPBACK.has(env.WRITE_HOST)) {
    error(`WRITE_HOST is ${env.WRITE_HOST}: the pilot must bind to 127.0.0.1, or it can be reached without Access.`)
  }
  if (env.WRITE_ACCESS_CERTS_URL) {
    error('WRITE_ACCESS_CERTS_URL is set: it is for tests and makes the server trust keys that are not Cloudflare\'s. Remove it.')
  }
  if (env.WRITE_ALLOWED_ORIGINS) {
    warning('WRITE_ALLOWED_ORIGINS is set: not needed when cloudflared keeps the Host header (no httpHostHeader).')
  }
  if (env.WRITE_DEV_USER) warning('WRITE_DEV_USER is set: it is ignored in Access mode.')
  if (env.WRITE_OWNER_EMAIL && !/[<>]/.test(env.WRITE_OWNER_EMAIL) && !isValidEmail(env.WRITE_OWNER_EMAIL.trim().toLowerCase())) {
    error(`WRITE_OWNER_EMAIL is not an email address: ${env.WRITE_OWNER_EMAIL}`)
  }

  // A missing or placeholder value was reported above; the server's own message would repeat it.
  const incomplete = findings.some((finding) => /placeholder|not set/.test(finding.message))
  let startupLine: string | undefined
  try {
    const config = resolveConfig('access', env, root)
    startupLine = describeConfig(config)
    if (config.collabPort === DEV_COLLAB_PORT) {
      error(`WRITE_COLLAB_PORT is ${DEV_COLLAB_PORT}, the dev server's collaboration port: pick another (e.g. 1235).`)
    }
    if (config.port === DEV_PORT) error(`WRITE_PORT is ${DEV_PORT}, the dev server's port: pick another (e.g. 4174).`)
    if (config.port === config.collabPort) error('WRITE_PORT and WRITE_COLLAB_PORT are the same port.')
    for (const name of ['WRITE_DATA_DIR', 'WRITE_BACKUP_DIR'] as const) {
      const raw = env[name] ?? ''
      if (!isAbsolute(raw)) {
        error(`${name} must be an absolute path, got "${raw}".`)
        continue
      }
      const dir = name === 'WRITE_DATA_DIR' ? config.dataDir : config.backupDir
      if (dir === root || dir.startsWith(root + sep)) {
        warning(`${name} is inside the checkout, which the unit keeps read-only: use /var/lib/write-pilot.`)
      }
      const state = writable(dir)
      if (state === 'read-only') error(`${name} ${dir} is not writable by this user.`)
      if (state === 'missing') {
        const parent = existingParent(dir, writable)
        warning(
          `${name} ${dir} does not exist yet. The server creates it if it can write to ${parent}; ` +
            'with the unit\'s StateDirectory=, /var/lib/write-pilot appears on the first start.',
        )
      }
    }
    if (config.dataDir === config.backupDir) error('WRITE_DATA_DIR and WRITE_BACKUP_DIR are the same directory.')
  } catch (failure) {
    if (!(failure instanceof ConfigError)) throw failure
    if (!incomplete) error(failure.message)
  }

  // The checkout: a build to serve, and no .env files that would add settings behind the env file's back.
  if (!existsSync(join(root, 'dist', 'index.html'))) error(`${join(root, 'dist')} has no build: run \`bun run build\`.`)
  // The unit bind-mounts its own folder over this one, which must exist (the build creates it).
  else if (!existsSync(join(root, 'node_modules', '.vite-temp'))) {
    error(`${join(root, 'node_modules', '.vite-temp')} is missing: run \`bun run build\` again.`)
  }
  if (root === '/home' || root.startsWith('/home/')) {
    warning(`The checkout ${root} is under /home, which the unit hides (ProtectHome=yes): use e.g. /opt/write-pilot.`)
  }
  for (const name of DOTENV_FILES) {
    const file = join(root, name)
    if (!existsSync(file)) continue
    const keys = Object.keys(parseEnvironmentFile(readFileSync(file, 'utf8')).env).filter((key) => key.startsWith('WRITE_'))
    if (keys.length) {
      error(`${file} sets ${keys.join(', ')}; \`vite preview\` reads it too. Keep every setting in the env file and delete it.`)
    }
  }
  return { findings, startupLine }
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: bun run pilot:check <env file>   (e.g. /etc/write-pilot/pilot.env)')
    process.exit(2)
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (failure) {
    console.error(`cannot read ${file}: ${(failure as Error).message}`)
    process.exit(2)
  }
  const root = resolve(import.meta.dirname, '..')
  const { findings, startupLine } = checkPilotEnv(text, { root })
  for (const { level, message } of findings) console.log(`${level === 'error' ? 'error  ' : 'warning'}  ${message}`)
  const errors = findings.filter((finding) => finding.level === 'error').length
  if (errors) {
    console.log(`\n${errors} error(s) in ${file}; the pilot would not start safely.`)
    process.exit(1)
  }
  console.log(`ok  ${file} looks right for the checkout in ${root}. The server will log:\n    ${startupLine}`)
}
