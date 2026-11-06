import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from '../store'
import { toast, usePauseOnInteraction, type ToastMessage } from '../toast'

const VISIBLE_MS = { info: 6000, error: 10_000 }

/** The document page's toast (`showToast` in toast.ts): it goes by itself after a few seconds, or with its button. */
export function Toast() {
  const message = useStore(toast)
  // Live regions only announce changes to content that is already mounted, so these stay in the
  // page and only their text changes; the visible toast is plain (and has the dismiss button).
  return (
    <>
      <div className="sr-only" role="status">
        {message?.tone === 'info' ? message.text : ''}
      </div>
      <div className="sr-only" role="alert">
        {message?.tone === 'error' ? message.text : ''}
      </div>
      {message && <ToastBox message={message} />}
    </>
  )
}

function ToastBox({ message }: { message: ToastMessage }) {
  // Own component so the pause state goes with the toast (a dismissed toast never gets its mouseleave).
  const { paused, props } = usePauseOnInteraction()
  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => {
      if (toast.get()?.id === message.id) toast.set(null)
    }, VISIBLE_MS[message.tone])
    return () => window.clearTimeout(timer)
  }, [message, paused])
  return (
    <div className={`doc-toast ${message.tone}`} {...props}>
      <span>{message.text}</span>
      <button type="button" className="doc-toast-close" aria-label="Dismiss" title="Dismiss" onClick={() => toast.set(null)}>
        <X aria-hidden size={16} />
      </button>
    </div>
  )
}
