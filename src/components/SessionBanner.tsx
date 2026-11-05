import { useCallback } from 'react'
import { probeSession } from '../api'
import { openSignIn, switchDevUser, useMe, useOtherUser, useWhileExpired } from '../session'

type SessionBannerProps = {
  /** Called once the session works again as this tab's User (so the editor can reconnect). */
  onSignedIn?: () => void
  /** On the editor: say that what was typed meanwhile is kept and will sync. */
  keepsChanges?: boolean
}

/**
 * "Your session expired", shown while Access refuses this tab, and "signed in as someone else",
 * shown when the browser's identity changed since this tab loaded. Signing in happens in a new
 * tab, because reloading this one would throw away edits that haven't synced yet.
 */
export function SessionBanner({ onSignedIn, keepsChanges }: SessionBannerProps) {
  const me = useMe()
  const other = useOtherUser()
  const check = useCallback(() => {
    void probeSession(me.email).then((result) => result === 'ok' && onSignedIn?.())
  }, [me.email, onSignedIn])
  const expired = useWhileExpired(check)

  if (other) {
    return (
      <div className="session-banner" role="alert">
        This tab is signed in as <strong>{me.email}</strong>, but your browser is now signed in as{' '}
        <strong>{other}</strong>
        {keepsChanges ? ', so this tab has stopped syncing. ' : '. '}
        <button type="button" className="link-button banner-button" onClick={() => window.location.reload()}>
          Reload as {other}
        </button>{' '}
        or{' '}
        {me.mode === 'dev' ? (
          <button
            type="button"
            className="link-button banner-button"
            onClick={() => {
              switchDevUser(me.email, { reload: false })
              check()
            }}
          >
            switch back to {me.email}
          </button>
        ) : (
          <>
            <button type="button" className="link-button banner-button" onClick={openSignIn}>
              sign in as {me.email} again
            </button>{' '}
            (opens a new tab)
          </>
        )}
        .{keepsChanges && ' Your changes here are kept and sync once you’re back.'}
      </div>
    )
  }
  if (!expired) return null
  return (
    <div className="session-banner" role="alert">
      Your session expired.{' '}
      <button type="button" className="link-button banner-button" onClick={openSignIn}>
        Sign in again
      </button>{' '}
      (opens a new tab).{keepsChanges && ' Your changes are kept in this tab and sync once you’re back.'}
    </div>
  )
}
