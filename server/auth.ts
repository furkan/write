import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { AuthSettings } from './config.ts'

/**
 * Who is making a request. In Access mode the user is the verified email in Cloudflare Access's
 * `Cf-Access-Jwt-Assertion` header (ADR 0001); in Dev mode it is the `write-dev-user` cookie,
 * else `WRITE_DEV_USER`, else `dev@localhost`, with no verification.
 */

/** A user, identified only by their email, trimmed and lowercased. */
export type User = { email: string }

const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'
/** Dev mode only: sets the identity, so several users can be tried in one browser. */
const DEV_USER_COOKIE = 'write-dev-user'

export const normalizeEmail = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

/** Reads a request header by lowercase name, whatever the server's header type. */
export type HeaderGetter = (name: string) => string | undefined

export const nodeHeaders =
  (headers: Record<string, string | string[] | undefined>): HeaderGetter =>
  (name) => {
    const value = headers[name]
    return Array.isArray(value) ? value.join(', ') : value
  }

export const fetchHeaders =
  (headers: Headers): HeaderGetter =>
  (name) =>
    headers.get(name) ?? undefined

export type Identity =
  | { ok: true; user: User }
  | {
      ok: false
      /** 401: no or invalid identity. 403: valid but unusable (no email, wrong origin). 503: can't verify now. */
      status: 401 | 403 | 503
      reason: string
      /** Extra fields for the audit log. */
      detail?: Record<string, unknown>
    }

export type Authenticator = {
  identify(header: HeaderGetter): Promise<Identity>
}

function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * jose errors that mean "this token is bad" (401). Anything else, such as the key set timing
 * out, answering 5xx or HTML (`ERR_JOSE_GENERIC`), or holding an unusable key, means the keys
 * can't be used right now (503): a Cloudflare blip must not look like an expired session.
 */
const isTokenError = (error: unknown): error is InstanceType<typeof errors.JOSEError> =>
  error instanceof errors.JOSEError &&
  (/^ERR_JW[TS]_/.test(error.code) ||
    ['ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS', 'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JOSE_NOT_SUPPORTED'].includes(
      error.code,
    ))

export function createAuthenticator(settings: AuthSettings): Authenticator {
  if (settings.mode === 'dev') {
    return {
      identify: async (header) => {
        const fromCookie = normalizeEmail(readCookie(header('cookie'), DEV_USER_COOKIE))
        const email = fromCookie && fromCookie.length <= 254 ? fromCookie : settings.devUser
        return { ok: true, user: { email } }
      },
    }
  }

  // Caches the keys and refetches when a token names an unknown `kid`, so key rotation just works.
  const keys = createRemoteJWKSet(new URL(settings.certsUrl))
  const issuer = `https://${settings.teamDomain}`
  return {
    identify: async (header) => {
      // Only the header: Cloudflare advises against trusting the CF_Authorization cookie.
      const token = header(ACCESS_JWT_HEADER)
      if (!token) return { ok: false, status: 401, reason: 'missing token' }
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience: settings.aud,
          algorithms: ['RS256'],
        })
        const email = normalizeEmail(payload.email)
        if (!email) {
          // A service token: it has `common_name` instead of an email. Not supported in the pilot.
          return {
            ok: false,
            status: 403,
            reason: 'token has no email',
            detail: { sub: payload.sub, common_name: payload.common_name },
          }
        }
        return { ok: true, user: { email } }
      } catch (error) {
        if (isTokenError(error)) {
          const claim = error instanceof errors.JWTClaimValidationFailed ? ` (${error.claim})` : ''
          return { ok: false, status: 401, reason: `${error.code}${claim}` }
        }
        const why = error instanceof Error ? error.message : String(error)
        console.error(`[write] could not use the Cloudflare Access signing keys from ${settings.certsUrl}: ${why}`)
        return { ok: false, status: 503, reason: 'signing keys unavailable' }
      }
    },
  }
}

/**
 * True when the request's `Origin` is its own `Host` or one of `allowedOrigins`. Browsers send
 * `Origin` on every cross-site request, on every non-GET request and on every WebSocket upgrade,
 * so this stops other sites from using the user's Access cookie (CSRF and cross-site WebSocket
 * hijacking). A request without `Origin` is refused.
 */
export function isAllowedOrigin(header: HeaderGetter, allowedOrigins: readonly string[]) {
  const origin = header('origin')
  if (!origin) return false
  if (allowedOrigins.includes(origin)) return true
  const host = header('host')
  if (!host) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host.toLowerCase()
  } catch {
    return false
  }
}

/**
 * The caller's identity, after the Origin check when `checkOrigin` is set (mutating REST
 * requests and every collaboration connection).
 */
export async function identifyRequest(
  authenticator: Authenticator,
  header: HeaderGetter,
  { checkOrigin, allowedOrigins }: { checkOrigin: boolean; allowedOrigins: readonly string[] },
): Promise<Identity> {
  if (checkOrigin && !isAllowedOrigin(header, allowedOrigins)) {
    return { ok: false, status: 403, reason: 'origin not allowed', detail: { origin: header('origin') ?? null } }
  }
  return authenticator.identify(header)
}
