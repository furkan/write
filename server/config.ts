import { isAbsolute, resolve } from 'node:path'
import { normalizeEmail } from './auth.ts'

/**
 * Server configuration from `WRITE_*` environment variables. `vite.config.ts` resolves it once
 * and passes it to the collaboration plugin; nothing else reads `process.env`.
 *
 * The auth mode follows the Vite command (ADR 0002): `vite dev` is Dev mode and `vite preview`
 * is Access mode, which refuses to start without `WRITE_ACCESS_TEAM_DOMAIN` and `WRITE_ACCESS_AUD`.
 * See `.env.example` for every variable.
 */

export type AuthMode = 'access' | 'dev'

export type AuthSettings =
  | {
      mode: 'dev'
      /** The identity when the request has no `write-dev-user` cookie. */
      devUser: string
    }
  | {
      mode: 'access'
      /** e.g. `acme.cloudflareaccess.com`; the JWT `iss` must be `https://<teamDomain>`. */
      teamDomain: string
      /** The Access application's AUD tag; the JWT `aud` must contain it. */
      aud: string
      /** Where the signing keys are fetched from. */
      certsUrl: string
    }

export type WriteConfig = {
  auth: AuthSettings
  /** Address the Vite server binds to. */
  host: string
  port: number
  /** Hocuspocus port, always bound to 127.0.0.1. */
  collabPort: number
  dataDir: string
  backupDir: string
  /** Extra `Host` names Vite accepts, after `.ts.net`. */
  allowedHosts: string[]
  /** Origins accepted besides the request's own `Host`, for mutating requests and collab connections. */
  allowedOrigins: string[]
  /** Owner given to documents that predate ownership (the legacy owner). Dev mode defaults it to the dev identity. */
  ownerEmail?: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

type Env = Record<string, string | undefined>

const DEFAULT_DEV_USER = 'dev@localhost'

const value = (env: Env, name: string) => {
  const raw = env[name]?.trim()
  return raw ? raw : undefined
}

const list = (env: Env, name: string) =>
  (value(env, name) ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

function port(env: Env, name: string, fallback: number) {
  const raw = value(env, name)
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new ConfigError(`${name} must be a port number (1-65535), got "${raw}".`)
  }
  return parsed
}

function origin(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
  } catch {
    // reported below
  }
  throw new ConfigError(`WRITE_ALLOWED_ORIGINS: "${raw}" is not an origin like https://write.example.com.`)
}

/** Accepts `acme.cloudflareaccess.com` or `https://acme.cloudflareaccess.com/`. */
function teamDomain(raw: string) {
  const domain = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(domain)) {
    throw new ConfigError(`WRITE_ACCESS_TEAM_DOMAIN must be a host name like acme.cloudflareaccess.com, got "${raw}".`)
  }
  return domain
}

function accessSettings(env: Env): AuthSettings {
  const team = value(env, 'WRITE_ACCESS_TEAM_DOMAIN')
  const aud = value(env, 'WRITE_ACCESS_AUD')
  const missing = [!team && 'WRITE_ACCESS_TEAM_DOMAIN', !aud && 'WRITE_ACCESS_AUD'].filter(Boolean)
  if (!team || !aud) {
    throw new ConfigError(
      `\`vite preview\` runs in Access mode and needs WRITE_ACCESS_TEAM_DOMAIN and WRITE_ACCESS_AUD ` +
        `(missing: ${missing.join(', ')}). See .env.example. For local work without Cloudflare Access, use \`bun dev\`.`,
    )
  }
  const domain = teamDomain(team)
  const certsUrl = value(env, 'WRITE_ACCESS_CERTS_URL') ?? defaultCertsUrl(domain)
  let url: URL
  try {
    url = new URL(certsUrl)
  } catch {
    throw new ConfigError(`WRITE_ACCESS_CERTS_URL is not a URL: "${certsUrl}".`)
  }
  // Whoever serves the keys decides who signs in. Plain http only for a local test key server.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new ConfigError(`WRITE_ACCESS_CERTS_URL must be https:// (or http:// on 127.0.0.1 for tests), got "${certsUrl}".`)
  }
  return { mode: 'access', teamDomain: domain, aud, certsUrl }
}

const defaultCertsUrl = (domain: string) => `https://${domain}/cdn-cgi/access/certs`

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)

/**
 * @param mode `dev` for `vite dev`, `access` for `vite preview`.
 * @param root Relative directories resolve against this (the project root).
 */
export function resolveConfig(mode: AuthMode, env: Env, root: string): WriteConfig {
  const devUser = normalizeEmail(value(env, 'WRITE_DEV_USER')) || DEFAULT_DEV_USER
  const auth: AuthSettings = mode === 'access' ? accessSettings(env) : { mode: 'dev', devUser }
  const dir = (name: string, fallback: string) => {
    const raw = value(env, name) ?? fallback
    return isAbsolute(raw) ? raw : resolve(root, raw)
  }
  return {
    auth,
    host: value(env, 'WRITE_HOST') ?? (mode === 'access' ? '127.0.0.1' : '0.0.0.0'),
    port: port(env, 'WRITE_PORT', mode === 'access' ? 4173 : 5173),
    collabPort: port(env, 'WRITE_COLLAB_PORT', 1234),
    dataDir: dir('WRITE_DATA_DIR', '.collab-data'),
    backupDir: dir('WRITE_BACKUP_DIR', '.collab-backups'),
    allowedHosts: list(env, 'WRITE_ALLOWED_HOSTS'),
    allowedOrigins: list(env, 'WRITE_ALLOWED_ORIGINS').map(origin),
    ownerEmail: normalizeEmail(value(env, 'WRITE_OWNER_EMAIL')) || (mode === 'dev' ? devUser : undefined),
  }
}

/** The one startup line naming the auth mode. */
export function describeConfig(config: WriteConfig) {
  const where = `data in ${config.dataDir}, collaboration on 127.0.0.1:${config.collabPort}`
  if (config.auth.mode === 'access') {
    const { teamDomain: domain, certsUrl } = config.auth
    // A WRITE_ACCESS_CERTS_URL left in an .env file would quietly trust other keys: always say so.
    const keys =
      certsUrl === defaultCertsUrl(domain)
        ? ''
        : `; WARNING: signing keys from ${certsUrl} (WRITE_ACCESS_CERTS_URL), not from Cloudflare`
    return `[write] Access mode: every request needs a Cloudflare Access JWT for team ${domain}${keys}; ${where}`
  }
  return `[write] Dev mode (no verification, not for the internet): identity from the write-dev-user cookie, else ${config.auth.devUser}; ${where}`
}
