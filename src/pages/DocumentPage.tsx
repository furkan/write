import 'katex/dist/katex.min.css'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocStatus, libraryUrl, probeSession, restoreOrConfirmOpen, trashUrl, type DocStatus, type Role } from '../api'
import { EditorMenus } from '../components/EditorMenus'
import { SessionBanner } from '../components/SessionBanner'
import { Header, type ViewOptions } from '../components/Header'
import { Sidebar, type EditorEvent } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { Toolbar } from '../components/Toolbar'
import { saveBackup } from '../editor/backup'
import { collabUser, getSession, getTitle, isDocEmpty, seedDoc, setTitle, type Session } from '../editor/collab'
import { buildExtensions } from '../editor/extensions'
import { useConnectionStatus, useDocTitle, usePresence } from '../editor/hooks'
import { findTemplate, type Template } from '../editor/templates'
import { accountAction, setSessionExpired, useMe } from '../session'
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

/**
 * Closed documents: the server refuses to sync them. `trashed` is the owner's own document in
 * the Trash (they can restore it); `trashed-by-owner` is one a collaborator had a share on.
 */
type Closed = 'trashed' | 'trashed-by-owner' | 'deleted' | 'none'

const closedState = (status: DocStatus): Closed | null =>
  status.deleted
    ? 'deleted'
    : status.trashed
      ? status.access === 'owner'
        ? 'trashed'
        : 'trashed-by-owner'
      : status.access === 'none'
        ? 'none'
        : null

/** `role` is `null` when the server couldn't be asked (offline): the editor opens anyway, unrestricted. */
type Opened = { state: Closed | 'open'; role: Role | null }

/** Whether the document is open (and with which role), in the Trash, or deleted forever. */
function useOpened(name: string): Opened | undefined {
  const [opened, setOpened] = useState<Opened | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    getDocStatus(name)
      .then((status) => {
        const closed = closedState(status)
        if (!cancelled) setOpened(closed ? { state: closed, role: null } : { state: 'open', role: status.access as Role })
      })
      // Server unreachable: try to open the document anyway (it works offline).
      .catch(() => !cancelled && setOpened({ state: 'open', role: null }))
    return () => {
      cancelled = true
    }
  }, [name])
  return opened
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
  const opened = useOpened(name)

  if (opened === undefined) return <Loading text="Opening document…" />
  if (opened.state === 'trashed') {
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
  if (opened.state === 'trashed-by-owner') {
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">The owner moved this document to the trash.</p>
        <p className="muted closed-text">You’ll have access again if they restore it.</p>
        <a className="primary-button" href={libraryUrl()}>
          Back to all documents
        </a>
      </div>
    )
  }
  if (opened.state === 'none') return <NoAccess />
  if (opened.state === 'deleted') {
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">This document was deleted.</p>
        <a className="primary-button" href={libraryUrl()}>
          Back to all documents
        </a>
      </div>
    )
  }
  return <SyncedDocument name={name} templateId={templateId} role={opened.role} />
}

/** No access: the same page whether the document never existed, is someone else's or was purged. */
function NoAccess() {
  const me = useMe()
  const action = accountAction(me)
  return (
    <div className="loading deleted" role="alert">
      <p className="deleted-title">This document doesn’t exist or hasn’t been shared with you.</p>
      <p className="muted closed-text">
        Signed in as <strong data-testid="signed-in-as">{me.email}</strong>.
      </p>
      <div className="closed-actions">
        <a className="primary-button" href={libraryUrl()}>
          Back to all documents
        </a>
        <button type="button" className="secondary-button" onClick={action.run}>
          {action.label}
        </button>
      </div>
    </div>
  )
}

function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      {text}
    </div>
  )
}

function SyncedDocument({ name, templateId, role }: DocumentPageProps & { role: Role | null }) {
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

  // Only the owner seeds a template: anyone else's seed would be local edits (a viewer's are
  // dropped by the server), and only a brand-new, empty document gets one.
  const template = empty && role === 'owner' ? findTemplate(templateId) : undefined
  return <Workspace session={session} template={template} initialRole={role} />
}

const MAX_EVENTS = 50

type WorkspaceProps = { session: Session; template: Template | undefined; initialRole: Role | null }

function Workspace({ session, template, initialRole }: WorkspaceProps) {
  const me = useMe()
  const [user] = useState(() => collabUser(me.email))
  // The caller's role, kept current: access changes close the socket, and on reconnect the
  // server may have made us a viewer or an editor. `null` while it is unknown (offline).
  const [role, setRole] = useState<Role | null>(initialRole)
  const viewer = role === 'viewer'
  const viewerRef = useRef(viewer)
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

  useEffect(() => {
    viewerRef.current = viewer
    if (viewer) window.clearTimeout(backupTimer.current)
  }, [viewer])

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

  // Viewers take no local backups: they can't change the document.
  const backup = useCallback(
    (e: Editor) => !viewerRef.current && saveBackup(e, me.email, session.name),
    [me.email, session.name],
  )

  // `getEditor` and `backup` are only called later from handlers, never during render.
  // oxlint-disable-next-line react/refs
  const [extensions] = useState(() => {
    const list = buildExtensions({
      session,
      user,
      onSave: backup,
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
    editable: initialRole !== 'viewer',
    editorProps: {
      attributes: { 'aria-label': 'Document', spellcheck: 'true' },
    },
    onCreate: () => logEvent('create', 'editor ready'),
    onUpdate: ({ editor: e, transaction }) => {
      const origin = isChangeOrigin(transaction) ? 'remote' : 'local'
      logEvent('update', `${origin} · ${transaction.steps.length} step(s) · size ${e.state.doc.content.size}`)
      // Back up your own edits only, so a collaborator wiping the doc can't overwrite your backup.
      if (origin === 'remote' || viewerRef.current) return
      window.clearTimeout(backupTimer.current)
      backupTimer.current = window.setTimeout(() => backup(e), 1000)
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

  // When the socket closes or is refused, find out why instead of showing "Offline" forever:
  // first whether the session expired (Access redirects `/api/me`; the banner then offers to
  // sign in again while the editor stays editable), then whether the document was moved to
  // the trash, deleted, or unshared, or our role changed.
  const [closed, setClosed] = useState<Closed | null>(null)
  const closedWhileOpen = closed !== null
  useEffect(() => {
    const { provider } = session
    let cancelled = false
    let lastCheck = 0
    const readStatus = () =>
      getDocStatus(session.name)
        .then((s) => {
          if (cancelled) return
          const next = closedState(s)
          if (next) setClosed(next)
          else setRole(s.access as Role)
        })
        .catch(() => undefined)
    // The provider retries refused connections in a loop; check at most every 3 s.
    const onRefused = () => {
      if (Date.now() - lastCheck < 3000) return
      lastCheck = Date.now()
      void probeSession().then((result) => {
        if (!cancelled && result === 'ok') void readStatus()
      })
    }
    // A socket the server accepted proves the session works, and may carry a new role.
    const onAuthenticated = () => {
      setSessionExpired(false)
      void readStatus()
    }
    provider.on('close', onRefused)
    provider.on('authenticationFailed', onRefused)
    provider.on('authenticated', onAuthenticated)
    return () => {
      cancelled = true
      provider.off('close', onRefused)
      provider.off('authenticationFailed', onRefused)
      provider.off('authenticated', onAuthenticated)
    }
  }, [session])

  useEffect(() => {
    if (!closedWhileOpen) return
    session.provider.destroy()
    editor.setEditable(false)
  }, [closedWhileOpen, editor, session.provider])

  // Viewers are always read-only; for owners and editors, Read-only is a view preference.
  const readOnly = view.readOnly || closedWhileOpen || viewer
  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])
  const title = useDocTitle(session)

  useEffect(() => {
    document.title = `${title || 'Untitled document'} – Write`
  }, [title])

  // After "Sign in again" worked in another tab, reconnect now rather than at the next retry.
  // A socket that is open but was refused for this document would never retry: replace it.
  const reconnect = useCallback(() => {
    const { provider } = session
    const socket = provider.configuration.websocketProvider
    if (socket.status === 'connected' && !provider.isAuthenticated) socket.webSocket?.close()
    else void socket.connect()
  }, [session])

  const classes = ['app', view.focusMode && 'focus-mode', readOnly && 'read-only', !view.sidebar && 'no-sidebar']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <Header
        editor={editor}
        session={session}
        presence={presence}
        role={role}
        view={{ ...view, readOnly }}
        canToggleReadOnly={!viewer && !closedWhileOpen}
        onBackup={backup}
        onViewChange={(next) => setView((prev) => ({ ...prev, ...next }))}
      />
      {closed && (
        <div className="deleted-banner" role="alert">
          {closed === 'trashed'
            ? 'This document was moved to the trash.'
            : closed === 'trashed-by-owner'
              ? 'The owner moved this document to the trash.'
              : closed === 'deleted'
                ? 'This document was deleted.'
                : 'You no longer have access to this document.'}{' '}
          Your view is read-only and changes are no longer saved.{' '}
          {closed === 'trashed' && (
            <>
              <RestoreButton name={session.name} className="link-button banner-button" /> ·{' '}
            </>
          )}
          <a href={libraryUrl()}>Back to all documents</a>
        </div>
      )}
      {!closed && <SessionBanner keepsChanges onSignedIn={reconnect} />}
      <div className="workspace">
        <main className="main">
          <Toolbar editor={editor} readOnly={readOnly} />
          <div className="editor-shell" data-tour="editor">
            <EditorContent editor={editor} className="editor" />
            <EditorMenus editor={editor} />
          </div>
        </main>
        {view.sidebar && <Sidebar editor={editor} toc={toc} events={events} onClearEvents={() => setEvents([])} />}
      </div>
      <StatusBar
        editor={editor}
        documentName={session.name}
        email={me.email}
        status={status}
        readOnly={view.readOnly && !viewer}
        viewer={viewer}
      />
    </div>
  )
}
