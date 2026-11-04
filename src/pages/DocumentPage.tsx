import 'katex/dist/katex.min.css'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocStatus, libraryUrl, restoreOrConfirmOpen, trashUrl, type DocStatus } from '../api'
import { EditorMenus } from '../components/EditorMenus'
import { Header, type ViewOptions } from '../components/Header'
import { Sidebar, type EditorEvent } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { Toolbar } from '../components/Toolbar'
import { saveBackup } from '../editor/backup'
import {
  getSession,
  getTitle,
  isDocEmpty,
  loadUser,
  saveUser,
  seedDoc,
  setTitle,
  type CollabUser,
  type Session,
} from '../editor/collab'
import { buildExtensions } from '../editor/extensions'
import { useConnectionStatus, useDocTitle, usePresence } from '../editor/hooks'
import { findTemplate, type Template } from '../editor/templates'
import { autoStartTour, startTour } from '../tours'

/** How long to wait for the collaboration server before opening the editor offline. */
const SYNC_TIMEOUT_MS = 4000

/**
 * Waits for the first sync with the collaboration server, so the editor never
 * writes its own empty document into the shared one before seeing the real content.
 */
function useInitialSync(session: Session): { ready: boolean; empty: boolean } {
  const { provider } = session
  const [state, setState] = useState(() =>
    provider.isSynced ? { ready: true, empty: isDocEmpty(session) } : { ready: false, empty: false },
  )

  useEffect(() => {
    if (state.ready) return
    const onSynced = ({ state: synced }: { state: boolean }) => {
      if (synced) setState({ ready: true, empty: isDocEmpty(session) })
    }
    // Offline: open the editor anyway; edits merge once the server is reachable.
    // Never seed in this case, or the demo content would be duplicated on reconnect.
    const timer = window.setTimeout(() => setState({ ready: true, empty: false }), SYNC_TIMEOUT_MS)
    provider.on('synced', onSynced)
    return () => {
      window.clearTimeout(timer)
      provider.off('synced', onSynced)
    }
  }, [provider, session, state.ready])

  return state
}

/** Trashed, deleted and inaccessible documents are closed: the server refuses to sync them. */
type Closed = 'trashed' | 'deleted' | 'none'

const closedState = (status: DocStatus): Closed | null =>
  status.deleted ? 'deleted' : status.trashed ? 'trashed' : status.access === 'none' ? 'none' : null

/** Whether the document is open, in the Trash, or deleted forever. */
function useClosed(name: string): Closed | 'open' | undefined {
  const [state, setState] = useState<Closed | 'open' | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    getDocStatus(name)
      .then((status) => !cancelled && setState(closedState(status) ?? 'open'))
      // Server unreachable: try to open the document anyway (it works offline).
      .catch(() => !cancelled && setState('open'))
    return () => {
      cancelled = true
    }
  }, [name])
  return state
}

/** Restores the document from the Trash and reloads the page to reconnect. */
function RestoreButton({ name, className }: { name: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const restore = async () => {
    setBusy(true)
    try {
      await restoreOrConfirmOpen(name)
      window.location.reload()
    } catch {
      setBusy(false)
      window.alert('Could not restore the document. It may have been deleted forever.')
    }
  }
  return (
    <button type="button" className={className} disabled={busy} onClick={() => void restore()}>
      {busy ? 'Restoring…' : 'Restore'}
    </button>
  )
}

type DocumentPageProps = { name: string; templateId: string | null }

export function DocumentPage({ name, templateId }: DocumentPageProps) {
  const state = useClosed(name)

  if (state === undefined) return <Loading text="Opening document…" />
  if (state === 'trashed') {
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">This document is in the trash.</p>
        <p className="muted">Restore it to keep editing.</p>
        <div className="closed-actions">
          <RestoreButton name={name} className="primary-button" />
          <a className="secondary-button" href={trashUrl()}>
            Open the trash
          </a>
        </div>
      </div>
    )
  }
  if (state === 'none') {
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">This document doesn’t exist or hasn’t been shared with you.</p>
        <a className="primary-button" href={libraryUrl()}>
          Back to all documents
        </a>
      </div>
    )
  }
  if (state === 'deleted') {
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">This document was deleted.</p>
        <a className="primary-button" href={libraryUrl()}>
          Back to all documents
        </a>
      </div>
    )
  }
  return <SyncedDocument name={name} templateId={templateId} />
}

function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      {text}
    </div>
  )
}

function SyncedDocument({ name, templateId }: DocumentPageProps) {
  const [session] = useState(() => getSession(name))
  const { ready, empty } = useInitialSync(session)

  // The template only applies to the first open; drop it from the URL afterwards.
  useEffect(() => {
    if (!ready || !templateId) return
    const url = new URL(window.location.href)
    url.searchParams.delete('template')
    window.history.replaceState(null, '', url)
  }, [ready, templateId])

  if (!ready) return <Loading text="Connecting to the shared document…" />

  const template = empty ? findTemplate(templateId) : undefined
  return <Workspace session={session} template={template} />
}

const MAX_EVENTS = 50

function Workspace({ session, template }: { session: Session; template: Template | undefined }) {
  const [user, setUser] = useState<CollabUser>(loadUser)
  const [toc, setToc] = useState<TableOfContentData>([])
  const [events, setEvents] = useState<EditorEvent[]>([])
  const [view, setView] = useState<ViewOptions>({
    readOnly: false,
    invisibles: false,
    focusMode: false,
    sidebar: true,
  })

  const editorRef = useRef<Editor | null>(null)
  const eventId = useRef(0)
  const backupTimer = useRef<number | undefined>(undefined)

  // Editor callbacks can fire while React is rendering (immediatelyRender), so
  // defer state updates to a microtask.
  const logEvent = useCallback((type: string, detail = '') => {
    queueMicrotask(() => {
      eventId.current += 1
      const event = { id: eventId.current, type, detail, at: Date.now() }
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
    })
  }, [])

  const getEditor = useCallback(() => editorRef.current, [])

  // `getEditor` is only called later from click handlers, never during render.
  // oxlint-disable-next-line react/refs
  const [extensions] = useState(() => {
    const list = buildExtensions({
      session,
      user,
      onSave: (e) => saveBackup(e, session.name),
      getEditor,
      onTableOfContents: (data) => queueMicrotask(() => setToc(data)),
    })
    // A brand-new document opened from a template gets its content written to Yjs
    // before the editor binds to it.
    if (template) {
      if (template.html) seedDoc(session, template.html, list)
      if (template.title && !getTitle(session)) setTitle(session, template.title)
    }
    return list
  })

  const editor = useEditor({
    extensions,
    immediatelyRender: true,
    editorProps: {
      attributes: { 'aria-label': 'Document', spellcheck: 'true' },
    },
    onCreate: () => logEvent('create', 'editor ready'),
    onUpdate: ({ editor: e, transaction }) => {
      const origin = isChangeOrigin(transaction) ? 'remote' : 'local'
      logEvent('update', `${origin} · ${transaction.steps.length} step(s) · size ${e.state.doc.content.size}`)
      // Back up your own edits only, so a collaborator wiping the doc can't overwrite your backup.
      if (origin === 'remote') return
      window.clearTimeout(backupTimer.current)
      backupTimer.current = window.setTimeout(() => saveBackup(e, session.name), 1000)
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection
      logEvent('selectionUpdate', from === to ? `cursor at ${from}` : `selected ${from}–${to}`)
    },
    onFocus: () => logEvent('focus'),
    onBlur: () => logEvent('blur'),
  })

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
      window.clearTimeout(backupTimer.current)
    }
  }, [editor])


  useEffect(() => {
    editor.commands.showInvisibleCharacters(view.invisibles)
  }, [editor, view.invisibles])

  // Tutorial overlays: auto-start once, and `?` replays the welcome tour.
  useEffect(() => {
    const cancelAutoStart = autoStartTour('welcome', 700)
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
      if (event.key === '?' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        startTour('welcome')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAutoStart()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const presence = usePresence(session.provider)
  const status = useConnectionStatus(session.provider)

  // If the server stops accepting this document, check whether it was moved to the trash
  // or deleted (by someone else, or in another tab) rather than showing "Offline" forever.
  const [closed, setClosed] = useState<Closed | null>(null)
  const closedWhileOpen = closed !== null
  useEffect(() => {
    const { provider } = session
    let cancelled = false
    let lastCheck = 0
    // The provider retries rejected connections in a loop; check at most every 3 s.
    const onClose = () => {
      if (Date.now() - lastCheck < 3000) return
      lastCheck = Date.now()
      getDocStatus(session.name)
        .then((s) => {
          const next = closedState(s)
          if (!cancelled && next) setClosed(next)
        })
        .catch(() => undefined)
    }
    provider.on('close', onClose)
    return () => {
      cancelled = true
      provider.off('close', onClose)
    }
  }, [session])

  useEffect(() => {
    if (!closedWhileOpen) return
    session.provider.destroy()
    editor.setEditable(false)
  }, [closedWhileOpen, editor, session.provider])

  useEffect(() => {
    editor.setEditable(!view.readOnly && !closedWhileOpen)
  }, [editor, view.readOnly, closedWhileOpen])
  const title = useDocTitle(session)

  useEffect(() => {
    document.title = `${title || 'Untitled document'} – Write`
  }, [title])

  const rename = () => {
    const name = window.prompt('Your name (shown to collaborators)', user.name)?.trim()
    if (!name) return
    const next = { ...user, name: name.slice(0, 40) }
    setUser(next)
    saveUser(next)
    editor.commands.updateUser(next)
  }

  const classes = ['app', view.focusMode && 'focus-mode', view.readOnly && 'read-only', !view.sidebar && 'no-sidebar']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <Header
        editor={editor}
        session={session}
        presence={presence}
        view={closedWhileOpen ? { ...view, readOnly: true } : view}
        onViewChange={(next) => setView((prev) => ({ ...prev, ...next }))}
      />
      {closed && (
        <div className="deleted-banner" role="alert">
          {closed === 'trashed'
            ? 'This document was moved to the trash.'
            : closed === 'deleted'
              ? 'This document was deleted.'
              : 'You no longer have access to this document.'}{' '}
          Your view
          is read-only and changes are no longer saved.{' '}
          {closed === 'trashed' && (
            <>
              <RestoreButton name={session.name} className="link-button banner-button" /> ·{' '}
            </>
          )}
          <a href={libraryUrl()}>Back to all documents</a>
        </div>
      )}
      <div className="workspace">
        <main className="main">
          <Toolbar editor={editor} readOnly={view.readOnly || closedWhileOpen} />
          <div className="editor-shell" data-tour="editor">
            <EditorContent editor={editor} className="editor" />
            <EditorMenus editor={editor} />
          </div>
        </main>
        {view.sidebar && <Sidebar editor={editor} toc={toc} events={events} onClearEvents={() => setEvents([])} />}
      </div>
      <StatusBar editor={editor} documentName={session.name} user={user} onRename={rename} status={status} readOnly={view.readOnly} />
    </div>
  )
}
