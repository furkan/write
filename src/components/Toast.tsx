import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from '../store'
import { toast, useAnnouncement, useExit, usePauseOnInteraction, type ToastMessage } from '../toast'

const VISIBLE_MS = { info: 6000, error: 10_000 }

/** The document page's toast (`showToast` in toast.ts): it goes by itself after a few seconds, or with its button. */
export function Toast() {
  const message = useStore(toast)
  const { shown, leaving } = useExit(message)
  // Live regions only announce changes to content that is already mounted, so these stay in the
  // page and only their text changes; the visible toast is plain (and has the dismiss button).
  const info = useAnnouncement(message?.tone === 'info' ? message.text : '', message?.id)
  const error = useAnnouncement(message?.tone === 'error' ? message.text : '', message?.id)
  return (
    <>
      <div className="sr-only" role="status">
        {info}
      </div>
      <div className="sr-only" role="alert">
        {error}
      </div>
      {shown && <ToastBox message={shown} leaving={leaving} />}
    </>
  )
}

function ToastBox({ message, leaving }: { message: ToastMessage; leaving: boolean }) {
  // Own component so the pause state goes with the toast (a dismissed toast never gets its mouseleave).
  const { paused, props } = usePauseOnInteraction()
  useEffect(() => {
    if (paused || leaving) return
    const timer = window.setTimeout(() => {
      if (toast.get()?.id === message.id) toast.set(null)
    }, VISIBLE_MS[message.tone])
    return () => window.clearTimeout(timer)
  }, [message, paused, leaving])
  return (
    <div className={`doc-toast ${message.tone}${leaving ? ' leaving' : ''}`} {...props}>
      <span>{message.text}</span>
      <button type="button" className="doc-toast-close" aria-label="Dismiss" title="Dismiss" onClick={() => toast.set(null)}>
        <X aria-hidden size={16} />
      </button>
    </div>
  )
}
