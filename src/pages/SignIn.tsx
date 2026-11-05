import { useEffect } from 'react'
import { libraryUrl } from '../api'
import { ClosedPage } from '../components/ClosedPage'
import { accountAction, announceSignedIn, useMe } from '../session'

/** Shown instead of any page when `/api/me` says nobody is signed in (401 or an Access redirect). */
export function SignIn() {
  useEffect(() => {
    document.title = 'Sign in – Write'
  }, [])
  return (
    <ClosedPage
      title="Sign in to Write"
      actions={
        // A full page load goes through Cloudflare Access, which shows its sign-in page.
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Sign in
        </button>
      }
    >
      Your session has expired, or Write couldn’t confirm who you are.
    </ClosedPage>
  )
}

/** Shown when `/api/me` failed for another reason (server down, or Access's keys unavailable). */
export function BootError() {
  return (
    <ClosedPage
      title="Write can’t reach the server."
      actions={
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Try again
        </button>
      }
    >
      Check your connection, then try again.
    </ClosedPage>
  )
}

/**
 * The tab "Sign in again" opens. Getting here means Access let us through, so the session works
 * again: tell the other tabs, which check who they're signed in as, then reconnect and sync.
 */
export function SignedInAgain() {
  const me = useMe()
  useEffect(() => {
    document.title = 'Signed in – Write'
    announceSignedIn()
  }, [])
  const action = accountAction(me)
  return (
    <ClosedPage
      title="You’re signed in again."
      role="status"
      actions={
        <>
          <button type="button" className="primary-button" onClick={() => window.close()}>
            Close this tab
          </button>
          <a className="secondary-button" href={libraryUrl()}>
            All documents
          </a>
          <button type="button" className="secondary-button" onClick={action.run}>
            {action.label}
          </button>
        </>
      }
    >
      Signed in as <strong>{me.email}</strong>. Your other Write tabs reconnect by themselves, so you can close this one.
    </ClosedPage>
  )
}
