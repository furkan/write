import { useCallback } from 'react'
import { probeSession } from '../api'
import { openSignIn, useWhileExpired } from '../session'

type SessionBannerProps = {
  /** Called once the session works again (so the editor can reconnect right away). */
  onSignedIn?: () => void
  /** On the editor: say that what was typed meanwhile is kept and will sync. */
  keepsChanges?: boolean
}

/**
 * "Your session expired": shown while Access refuses this tab. Signing in happens in a new tab,
 * because reloading this one would throw away edits that haven't synced yet.
 */
export function SessionBanner({ onSignedIn, keepsChanges }: SessionBannerProps) {
  const check = useCallback(() => {
    void probeSession().then((result) => result === 'ok' && onSignedIn?.())
  }, [onSignedIn])
  const expired = useWhileExpired(check)
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
