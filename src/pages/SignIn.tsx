import { useEffect } from 'react'
import { libraryUrl } from '../api'
import { accountAction, announceSignedIn, useMe } from '../session'

/** Shown instead of any page when `/api/me` says nobody is signed in (401 or an Access redirect). */
export function SignIn() {
  useEffect(() => {
    document.title = 'Sign in – Write'
  }, [])
  return (
    <div className="loading deleted" role="alert">
      <span className="logo" aria-hidden>
        ✍️
      </span>
      <p className="deleted-title">Sign in to Write</p>
      <p className="muted closed-text">Your session has expired, or Write couldn’t confirm who you are.</p>
      {/* A full page load goes through Cloudflare Access, which shows its sign-in page. */}
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>
        Sign in
      </button>
    </div>
  )
}

/** Shown when `/api/me` failed for another reason (server down, or Access's keys unavailable). */
export function BootError() {
  return (
    <div className="loading deleted" role="alert">
      <p className="deleted-title">Write can’t reach the server.</p>
      <p className="muted closed-text">Check your connection, then try again.</p>
      <button type="button" className="primary-button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </div>
  )
}

/**
 * The tab "Sign in again" opens. Getting here means Access let us through, so the session works
 * again: tell the other tabs, which reconnect and sync what they kept.
 */
export function SignedInAgain() {
  const me = useMe()
  useEffect(() => {
    document.title = 'Signed in – Write'
    announceSignedIn()
  }, [])
  const action = accountAction(me)
  return (
    <div className="loading deleted" role="status">
      <p className="deleted-title">You’re signed in again.</p>
      <p className="muted closed-text">
        Signed in as <strong>{me.email}</strong>. Your other Write tabs reconnect by themselves, so you can close this one.
      </p>
      <div className="closed-actions">
        <button type="button" className="primary-button" onClick={() => window.close()}>
          Close this tab
        </button>
        <a className="secondary-button" href={libraryUrl()}>
          All documents
        </a>
        <button type="button" className="secondary-button" onClick={action.run}>
          {action.label}
        </button>
      </div>
    </div>
  )
}
