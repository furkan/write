import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import type { Me } from './api'
import { isValidEmail, normalizeEmail } from './identity'

/**
 * Who is signed in (loaded once at boot from `/api/me`) and whether their session has expired.
 * A Session expired is not a network drop: Access answers our fetches with a redirect
 * (`opaqueredirect` with `redirect: 'manual'`) or the server answers 401.
 */

export const MeContext = createContext<Me | null>(null)

/** The signed-in User. Only used below `App`, which renders nothing else until `/api/me` loads. */
export function useMe(): Me {
  const me = useContext(MeContext)
  if (!me) throw new Error('useMe() outside <MeContext>')
  return me
}

// ---------- Session expired ----------

let expired = false
const listeners = new Set<() => void>()

export function setSessionExpired(next: boolean) {
  if (expired === next) return
  expired = next
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export const useSessionExpired = () => useSyncExternalStore(subscribe, () => expired)

/** Other tabs of this app, told when a sign-in in a new tab worked. */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('write:session')

export const announceSignedIn = () => channel?.postMessage('signed-in')

/**
 * While the session is expired, calls `check` when this tab regains focus, when another tab
 * says it signed in, and every 15 s, so the banner clears soon after "Sign in again" worked.
 */
export function useWhileExpired(check: () => void) {
  const isExpired = useSessionExpired()
  useEffect(() => {
    if (!isExpired) return
    const onMessage = (event: MessageEvent) => event.data === 'signed-in' && check()
    const timer = window.setInterval(check, 15_000)
    window.addEventListener('focus', check)
    channel?.addEventListener('message', onMessage)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      channel?.removeEventListener('message', onMessage)
    }
  }, [isExpired, check])
  return isExpired
}

/** The page "Sign in again" opens: going through Access refreshes the cookie, then it says so. */
export const signedInUrl = () => `${window.location.pathname}?signed-in`

/**
 * Opens the sign-in tab. Not a `noopener` link, so that tab may close itself when done; it is
 * our own origin.
 */
export const openSignIn = () => void window.open(signedInUrl(), '_blank')

// ---------- Account actions ----------

/** Cloudflare Access's own sign-out endpoint (Access mode). */
export const SIGN_OUT_URL = '/cdn-cgi/access/logout'

const DEV_USER_COOKIE = 'write-dev-user'

/**
 * Dev mode only (the server ignores the cookie in Access mode): become `email`, or the server's
 * default dev identity when `email` is empty. Reloads, so every connection uses the new identity.
 */
export function switchDevUser(email: string) {
  const attributes = '; path=/; samesite=lax'
  document.cookie = email
    ? `${DEV_USER_COOKIE}=${encodeURIComponent(email)}${attributes}; max-age=31536000`
    : `${DEV_USER_COOKIE}=${attributes}; max-age=0`
  window.location.reload()
}

/** Dev mode: asks which User to become; empty means the server's default dev identity. */
function promptSwitchUser(current: string) {
  const answer = window.prompt('Switch to which user? Enter an email, or leave it empty for the default dev user.', current)
  if (answer === null) return
  const email = normalizeEmail(answer)
  if (email === current) return
  if (email && !isValidEmail(email)) {
    window.alert(`“${answer}” isn’t an email address.`)
    return
  }
  switchDevUser(email)
}

/** "Sign out" in Access mode, "Switch user…" in Dev mode. */
export function accountAction(me: Me): { label: string; run: () => void } {
  return me.mode === 'access'
    ? { label: 'Sign out', run: () => window.location.assign(SIGN_OUT_URL) }
    : { label: 'Switch user…', run: () => promptSwitchUser(me.email) }
}
