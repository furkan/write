import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, displayTitle, docUrl, getDoc, shareDoc, unshareDoc, type DocMeta, type Role, type ShareRole, type Shares } from '../api'
import { isValidEmail, MAX_SHARES, normalizeEmail } from '../identity'
import { useMe } from '../session'
import { Avatar } from './Avatar'

type SharedDoc = DocMeta & { shares: Shares }

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }

/** "an editor" or "a viewer". */
const withArticle = (role: ShareRole) => (role === 'editor' ? 'an editor' : 'a viewer')

/** What went wrong, in words, for a failed share request. */
function shareError(error: unknown, isSelf: boolean): string {
  if (!(error instanceof ApiError)) return 'Couldn’t reach the server. Check your connection and try again.'
  switch (error.status) {
    case 400:
      if (error.error === 'invalid email') return 'Enter a valid email address, such as name@example.com.'
      if (error.error === 'the owner already has access')
        return isSelf ? 'You own this document, so you already have access.' : 'That’s the owner: they already have access.'
      return 'The server refused that change.'
    case 401:
      return 'Your session expired. Sign in again, then retry.'
    case 403:
      return 'Only the owner can change who has access.'
    case 404:
      return 'This document is no longer available. It may have been moved to the trash.'
    case 409:
      return `A document can be shared with at most ${MAX_SHARES} people. Remove someone first.`
    default:
      return 'Something went wrong. Try again.'
  }
}

type ShareDialogProps = {
  docId: string
  onClose: () => void
  /** Called with the new shares after each change the owner makes. */
  onChange?: (doc: SharedDoc) => void
}

/**
 * Who has access to a document. The owner adds people by email as Editor or Viewer, changes
 * roles and removes people; everyone else sees the list read-only. Invite only: the link
 * works just for the people listed here.
 */
export function ShareDialog({ docId, onClose, onChange }: ShareDialogProps) {
  const me = useMe()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const errorId = useId()
  const [doc, setDoc] = useState<SharedDoc | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('editor')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let cancelled = false
    getDoc(docId).then(
      (loaded) => !cancelled && setDoc(loaded),
      (err: unknown) => !cancelled && setLoadError(shareError(err, false)),
    )
    return () => {
      cancelled = true
    }
  }, [docId])

  const isOwner = doc?.role === 'owner'
  const people = doc ? Object.entries(doc.shares).sort(([a], [b]) => a.localeCompare(b)) : []
  const link = `${window.location.origin}${docUrl(docId)}`

  const apply = async (change: () => Promise<SharedDoc | void>, done: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = (await change()) ?? (await getDoc(docId))
      setDoc(next)
      onChange?.(next)
      setNotice(done)
      return true
    } catch (err) {
      setError(shareError(err, false))
      return false
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!doc) return
    const target = normalizeEmail(email)
    setNotice(null)
    if (!isValidEmail(target)) return setError('Enter a valid email address, such as name@example.com.')
    if (target === doc.owner) {
      return setError(target === me.email ? 'You own this document, so you already have access.' : 'That’s the owner: they already have access.')
    }
    const existing = doc.shares[target]
    if (existing === role) return setError(`${target} is already ${withArticle(role)}.`)
    if (!existing && people.length >= MAX_SHARES) {
      return setError(`A document can be shared with at most ${MAX_SHARES} people. Remove someone first.`)
    }
    const ok = await apply(
      () => shareDoc(docId, target, role),
      existing ? `${target} is now ${withArticle(role)}.` : `Shared with ${target}.`,
    )
    if (ok) setEmail('')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link', link)
    }
  }

  const close = () => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      className="share-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop (the dialog element itself, outside its content) closes it.
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div className="share-content">
        <h2 id={titleId} className="share-title">
          {doc ? `Share “${displayTitle(doc)}”` : 'Share'}
        </h2>

        {loadError ? (
          <p className="share-error" role="alert">
            {loadError}
          </p>
        ) : !doc ? (
          <div className="loading inline" role="status">
            <span className="spinner" aria-hidden /> Loading…
          </div>
        ) : (
          <>
            {isOwner && (
              <form className="share-form" onSubmit={(e) => void submit(e)} noValidate>
                <input
                  type="email"
                  className="share-email"
                  placeholder="Add people by email"
                  aria-label="Email address"
                  aria-describedby={error ? errorId : undefined}
                  aria-invalid={error ? true : undefined}
                  autoComplete="off"
                  autoFocus
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                />
                <select aria-label="Role for the new person" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit" className="primary-button" disabled={busy || !email.trim()}>
                  Share
                </button>
              </form>
            )}
            {error && (
              <p id={errorId} className="share-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="share-notice" role="status">
                {notice}
              </p>
            )}
            {isOwner && <p className="muted small share-note">They also need access to Write; ask the admin.</p>}

            <h3 className="share-subtitle">People with access</h3>
            <ul className="share-list" aria-label="People with access">
              <Person email={doc.owner} me={me.email}>
                <span className="share-role">{ROLE_LABEL.owner}</span>
              </Person>
              {people.map(([person, personRole]) => (
                <Person key={person} email={person} me={me.email}>
                  {isOwner ? (
                    <>
                      <select
                        aria-label={`Role for ${person}`}
                        value={personRole}
                        disabled={busy}
                        onChange={(e) => {
                          const next = e.target.value as ShareRole
                          void apply(() => shareDoc(docId, person, next), `${person} is now ${withArticle(next)}.`)
                        }}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        className="icon-button"
                        title={`Remove ${person}`}
                        aria-label={`Remove ${person}`}
                        disabled={busy}
                        onClick={() => void apply(() => unshareDoc(docId, person), `Removed ${person}.`)}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <span className="share-role">{ROLE_LABEL[personRole]}</span>
                  )}
                </Person>
              ))}
            </ul>
            {!isOwner && <p className="muted small share-note">Only the owner can change who has access.</p>}
            {isOwner && people.length === 0 && <p className="muted small share-note">Only you can open this document.</p>}
          </>
        )}

        <div className="share-footer">
          <button type="button" className="secondary-button" onClick={() => void copyLink()} title="Only people with access can open it">
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button type="button" className="primary-button" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

function Person({ email, me, children }: { email: string; me: string; children: ReactNode }) {
  return (
    <li className="share-person">
      <Avatar email={email} />
      <span className="share-person-email" title={email}>
        {email}
        {email === me && <span className="muted"> (you)</span>}
      </span>
      <span className="share-person-actions">{children}</span>
    </li>
  )
}
