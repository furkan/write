import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from '../store'
import { toast } from '../toast'

const VISIBLE_MS = { info: 6000, error: 10_000 }

/** The document page's toast (`showToast` in toast.ts): it goes by itself after a few seconds, or with its button. */
export function Toast() {
  const message = useStore(toast)
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => {
      if (toast.get()?.id === message.id) toast.set(null)
    }, VISIBLE_MS[message.tone])
    return () => window.clearTimeout(timer)
  }, [message])
  if (!message) return null
  return (
    <div className={`doc-toast ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
      <span>{message.text}</span>
      <button type="button" className="doc-toast-close" aria-label="Dismiss" title="Dismiss" onClick={() => toast.set(null)}>
        <X aria-hidden size={16} />
      </button>
    </div>
  )
}
