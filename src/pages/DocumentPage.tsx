import 'katex/dist/katex.min.css'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getDocStatus, libraryUrl, probeSession, restoreOrConfirmOpen, trashUrl, type DocStatus, type Role } from '../api'
import { ClosedPage } from '../components/ClosedPage'
import { EditorMenus } from '../components/EditorMenus'
import { Header, type ViewOptions } from '../components/Header'
import { SessionBanner } from '../components/SessionBanner'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { Toolbar } from '../components/Toolbar'
import { adoptLegacyBackup, saveBackup } from '../editor/backup'
import { collabUser, getSession, getTitle, isDocEmpty, resume, seedDoc, setTitle, type Session } from '../editor/collab'
import { buildExtensions } from '../editor/extensions'
import { useConnectionStatus, useDocTitle, usePendingChanges, usePresence, useRetrying } from '../editor/hooks'
import { findTemplate, type Template } from '../editor/templates'
import { accountAction, setSessionExpired, useMe } from '../session'
import { autoStartTour, setTourContext, startTour } from '../tours'

/** How long to wait for the collaboration server before opening the editor offline. */
const SYNC_TIMEOUT_MS = 4000
/** How long a template waits to learn whether we own the document before opening without it. */
const OWNER_WAIT_MS = 10_000

/**
 * Waits for the first sync with the collaboration server, so the editor never
 * writes its own empty document into the shared one before seeing the real content.
 */
function useInitialSync(session: Session): { ready: boolean; empty: boolean; synced: boolean } {
  const { provider } = session
  const [state, setState] = useState(() =>
    provider.isSynced
      ? { ready: true, empty: isDocEmpty(session), synced: true }
      : { ready: false, empty: false, synced: false },
  )

  useEffect(() => {
    if (state.ready) return
    const onSynced = ({ state: synced }: { state: boolean }) => {
      if (synced) setState({ ready: true, empty: isDocEmpty(session), synced: true })
    }
    // Offline: open the editor anyway; edits merge once the server is reachable.
    // Never seed in this case, or the demo content would be duplicated on reconnect.
    const timer = window.setTimeout(() => setState({ ready: true, empty: false, synced: false }), SYNC_TIMEOUT_MS)
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

/** `access` is `null` when `/status` couldn't be read at open; the socket's scope then decides. */
type Opened = { state: Closed | 'open'; access: Role | null }

/** Whether the document is open (and with which role), in the Trash, or deleted forever. */
function useOpened(name: string): Opened | undefined {
  const [opened, setOpened] = useState<Opened | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    getDocStatus(name)
      .then((status) => {
        const closed = closedState(status)
        if (!cancelled) setOpened(closed ? { state: closed, access: null } : { state: 'open', access: status.access as Role })
      })
      // Server unreachable: try to open the document anyway (it works offline, read-only until
      // the socket says what we may do).
      .catch(() => !cancelled && setOpened({ state: 'open', access: null }))
    return () => {
      cancelled = true
    }
  }, [name])
  return opened
}

type RoleState = {
  /** `null` while unknown: nothing has said yet whether we may write, so treat as read-only. */
  role: Role | null
  /** Whether we know if we're the owner (for template seeding and owner-only actions). */
  ownerKnown: boolean
}

/**
 * The caller's role, from the socket first: the server's `authenticated` message carries the
 * scope it enforces (`readonly` for viewers), on every (re)connect, so a promotion or demotion
 * applies the moment the socket reconnects. Owner versus editor comes from `/status`; ownership
 * never changes, so it is asked until known. Before the socket has authenticated, `/status` at
 * open is the best guess.
 */
function useRole(session: Session, initialAccess: Role | null): RoleState {
  const { provider } = session
  // The provider keeps the last scope across disconnects, which is what we want: a dropped
  // connection doesn't change what we may do.
  const subscribe = useCallback(
    (onChange: () => void) => {
      provider.on('authenticated', onChange)
      return () => void provider.off('authenticated', onChange)
    },
    [provider],
  )
  const scope = useSyncExternalStore(subscribe, () => provider.authorizedScope)
  const [owner, setOwner] = useState<boolean | null>(initialAccess === null ? null : initialAccess === 'owner')

  useEffect(() => {
    if (owner !== null || scope !== 'read-write') return
    let cancelled = false
    let timer: number | undefined
    const ask = () =>
      getDocStatus(session.name).then(
        (status) => {
          if (cancelled) return
          if (status.access === 'none') return // closed: the Workspace's own check handles it
          setOwner(status.access === 'owner')
        },
        () => {
          if (!cancelled) timer = window.setTimeout(ask, 3000)
        },
      )
    void ask()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [owner, scope, session.name])

  const role: Role | null =
    scope === 'readonly' ? 'viewer' : scope === 'read-write' ? (owner ? 'owner' : 'editor') : initialAccess
  return { role, ownerKnown: owner !== null }
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

const backLink = (
  <a className="primary-button" href={libraryUrl()}>
    Back to all documents
  </a>
)

type DocumentPageProps = { name: string; templateId: string | null }

export function DocumentPage({ name, templateId }: DocumentPageProps) {
  const opened = useOpened(name)

  if (opened === undefined) return <Loading text="Opening document…" />
  switch (opened.state) {
    case 'trashed':
      return (
        <ClosedPage
          title="This document is in the trash."
          actions={
            <>
              <RestoreButton name={name} className="primary-button" />
              <a className="secondary-button" href={trashUrl()}>
                Open the trash
              </a>
            </>
          }
        >
          Restore it to keep editing.
        </ClosedPage>
      )
    case 'trashed-by-owner':
      return (
        <ClosedPage title="The owner moved this document to the trash." actions={backLink}>
          You’ll have access again if they restore it.
        </ClosedPage>
      )
    case 'none':
      return <NoAccess />
    case 'deleted':
      return <ClosedPage title="This document was deleted." actions={backLink} />
    default:
      return <SyncedDocument name={name} templateId={templateId} access={opened.access} />
  }
}

/** No access: the same page whether the document never existed, is someone else's or was purged. */
function NoAccess() {
  const me = useMe()
  const action = accountAction(me)
  return (
    <ClosedPage
      title="This document doesn’t exist or hasn’t been shared with you."
      actions={
        <>
          {backLink}
          <button type="button" className="secondary-button" onClick={action.run}>
            {action.label}
          </button>
        </>
      }
    >
      Signed in as <strong data-testid="signed-in-as">{me.email}</strong>.
    </ClosedPage>
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

function SyncedDocument({ name, templateId, access }: DocumentPageProps & { access: Role | null }) {
  const me = useMe()
  const [session] = useState(() =>
    getSession(name, async () => {
      // Before anything syncs on a (re)opened socket: are we still who this tab loaded as?
      if ((await probeSession(me.email)) === 'other-user') throw new Error('signed in as someone else')
    }),
  )
  const { ready, empty, synced } = useInitialSync(session)
  const { role, ownerKnown } = useRole(session, access)

  // Only the owner seeds a template, and only into a brand-new, empty document: anyone else's
  // seed would be local edits (a viewer's are dropped by the server). If we can't tell yet
  // whether we're the owner, wait for it rather than drop the template.
  const template = templateId && empty ? findTemplate(templateId) : undefined
  const waitingForOwner = ready && !!template && !ownerKnown
  // If the server can't say for a while, open without the template; `?template=` stays in the
  // URL, so a reload tries again.
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!waitingForOwner) return
    const timer = window.setTimeout(() => setGaveUp(true), OWNER_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [waitingForOwner])
  const decided = ready && (!waitingForOwner || gaveUp)

  // The template only applies to the first open; drop it from the URL once it has been applied,
  // or once we know it won't be (the document isn't empty, or we aren't its owner). Not when
  // we opened offline or gave up: a reload should try again.
  const settled = synced && (!template || ownerKnown)
  useEffect(() => {
    if (!settled || !templateId) return
    const url = new URL(window.location.href)
    url.searchParams.delete('template')
    window.history.replaceState(null, '', url)
  }, [settled, templateId])

  if (!decided) return <Loading text="Connecting to the shared document…" />
  return <Workspace session={session} template={role === 'owner' ? template : undefined} role={role} />
}

type WorkspaceProps = { session: Session; template: Template | undefined; role: Role | null }

function Workspace({ session, template, role }: WorkspaceProps) {
  const me = useMe()
  const [user] = useState(() => collabUser(me.email))
  // Only owners and editors write. Viewers, and anyone whose role isn't known yet, read.
  const canWrite = role === 'owner' || role === 'editor'
  const viewer = role === 'viewer'
  const canWriteRef = useRef(canWrite)
  const [toc, setToc] = useState<TableOfContentData>([])
  const [view, setView] = useState<ViewOptions>({
    readOnly: false,
    invisibles: false,
    focusMode: false,
    sidebar: true,
  })

  const editorRef = useRef<Editor | null>(null)
  const backupTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    canWriteRef.current = canWrite
    if (!canWrite) window.clearTimeout(backupTimer.current)
  }, [canWrite])

  // A backup made in this browser before documents had owners belongs to the owner.
  useEffect(() => {
    if (role === 'owner') adoptLegacyBackup(me.email, session.name)
  }, [role, me.email, session.name])

  const getEditor = useCallback(() => editorRef.current, [])

  // Only people who can change the document take local backups.
  const backup = useCallback(
    (e: Editor) => canWriteRef.current && saveBackup(e, me.email, session.name),
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
    editable: canWrite,
    editorProps: {
      attributes: { 'aria-label': 'Document', spellcheck: 'true' },
    },
    onUpdate: ({ editor: e, transaction }) => {
      // Back up your own changes only, so a collaborator wiping the doc can't overwrite your
      // backup: not what arrives through Yjs (a collaborator's edit, the content loading), and
      // not transactions that change nothing (opening a document dispatches one).
      if (isChangeOrigin(transaction) || !transaction.docChanged || !canWriteRef.current) return
      window.clearTimeout(backupTimer.current)
      backupTimer.current = window.setTimeout(() => backup(e), 1000)
    },
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

  // Tutorial overlays: auto-start once, and `?` replays the welcome tour. They describe what
  // this user can do here.
  useEffect(() => {
    setTourContext({ role, mode: me.mode })
  }, [role, me.mode])
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

  const { provider } = session
  const presence = usePresence(provider)
  const status = useConnectionStatus(provider)
  const pending = usePendingChanges(provider)
  const retrying = useRetrying(session)

  // Demoted to viewer: lock the editor in the same tick the socket says so, before the next
  // keystroke, rather than after React re-renders.
  useEffect(() => {
    const onAuthenticated = ({ scope }: { scope: string }) => {
      setSessionExpired(false)
      if (scope === 'readonly') editorRef.current?.setEditable(false)
    }
    provider.on('authenticated', onAuthenticated)
    return () => {
      provider.off('authenticated', onAuthenticated)
    }
  }, [provider])

  // When the socket closes or is refused, find out why instead of showing "Offline" forever:
  // first whether the session expired (Access redirects `/api/me`; the banner then offers to
  // sign in again while the editor stays editable) or now belongs to someone else, then
  // whether the document was moved to the trash, deleted, or unshared.
  const [closed, setClosed] = useState<Closed | null>(null)
  const closedWhileOpen = closed !== null
  useEffect(() => {
    let cancelled = false
    let lastCheck = 0
    let pending: number | undefined
    // The provider retries refused connections in a loop; check at most every 3 s. A refusal
    // within 3 s of the last check is checked when they are up, not dropped: a socket refused
    // for this document stays open without retrying, so there may be no later event.
    const onRefused = () => {
      const wait = lastCheck + 3000 - Date.now()
      if (wait > 0) {
        pending ??= window.setTimeout(() => {
          pending = undefined
          onRefused()
        }, wait)
        return
      }
      lastCheck = Date.now()
      void probeSession(me.email).then(async (result) => {
        if (cancelled || result !== 'ok') return
        const next = closedState(await getDocStatus(session.name))
        if (!cancelled && next) setClosed(next)
      }).catch(() => undefined)
    }
    provider.on('close', onRefused)
    provider.on('authenticationFailed', onRefused)
    return () => {
      cancelled = true
      window.clearTimeout(pending)
      provider.off('close', onRefused)
      provider.off('authenticationFailed', onRefused)
    }
  }, [provider, session.name, me.email])

  useEffect(() => {
    if (!closedWhileOpen) return
    provider.destroy()
    editor.setEditable(false)
  }, [closedWhileOpen, editor, provider])

  // Viewers (and an unknown role) are always read-only; for owners and editors, Read-only is a
  // view preference.
  const readOnly = view.readOnly || closedWhileOpen || !canWrite
  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])
  const title = useDocTitle(session)

  useEffect(() => {
    document.title = `${title || 'Untitled document'} – Write`
  }, [title])

  // Edits the server refused: typed just before a demotion took effect. They stay on screen
  // here but are not in the shared document, so say so.
  const lostEdits = viewer && pending && status === 'connected' && !closedWhileOpen

  const reconnect = useCallback(() => resume(session), [session])

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
        canToggleReadOnly={canWrite && !closedWhileOpen}
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
      {lostEdits && (
        <div className="deleted-banner lost-edits" role="alert">
          You can only view this document now, so your latest changes weren’t saved. They’re still on this screen until
          you reload: copy them, or use File → Export, if you need them.
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
        {view.sidebar && <Sidebar editor={editor} toc={toc} />}
      </div>
      <StatusBar
        editor={editor}
        documentName={session.name}
        email={me.email}
        status={status}
        pending={pending}
        retrying={retrying}
        readOnly={view.readOnly && canWrite}
        role={role}
      />
    </div>
  )
}
