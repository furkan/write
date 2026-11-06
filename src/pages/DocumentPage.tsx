import 'katex/dist/katex.min.css'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react'
import { getDocStatus, libraryUrl, probeSession, restoreOrConfirmOpen, trashUrl, type DocStatus, type Role } from '../api'
import { ClosedPage } from '../components/ClosedPage'
import { EditorMenus } from '../components/EditorMenus'
import { BarActions, DocumentTitle } from '../components/ribbon/BarItems'
import { canWrite as canWriteAs, DocumentChromeContext, type DocumentChrome, type ViewOptions } from '../components/ribbon/documentContext'
import { Ribbon } from '../components/ribbon/Ribbon'
import { useMediaQuery } from '../components/ribbon/state'
import { SessionBanner } from '../components/SessionBanner'
import { Toast } from '../components/Toast'
import { ShareDialog } from '../components/ShareDialog'
import { Sidebar } from '../components/Sidebar'
import { StatusBar } from '../components/StatusBar'
import { adoptLegacyBackup, saveBackup } from '../editor/backup'
import { collabUser, getSession, getTitle, isDocEmpty, resume, seedDoc, setTitle, type Session } from '../editor/collab'
import { buildExtensions } from '../editor/extensions'
import { useConnectionStatus, useDocTitle, usePendingChanges, usePresence, useRetrying } from '../editor/hooks'
import { pageGeometry, pageRules, trackPageSetupUndo, usePagedView, usePageSetup } from '../editor/page-setup'
import { findTemplate, type Template } from '../editor/templates'
import { setDocumentScroller } from '../editor/scroller'
import { fitZoom, useZoomSetting, type ZoomFit } from '../editor/zoom'
import { accountAction, setSessionExpired, useMe } from '../session'
import { autoStartTour, setTourContext, startTour } from '../tours'
import '../layout.css'

/** How long to wait for the collaboration server before opening the editor offline. */
const SYNC_TIMEOUT_MS = 4000
/** How long a template waits to learn whether we own the document before opening without it. */
const OWNER_WAIT_MS = 10_000

/**
 * Room Print layout needs beside the page for the sidebar: the canvas padding (48), the column
 * gap (24), the sidebar (320), the workspace padding (32) and a scrollbar (16). Narrower, the
 * sidebar goes below the document, as it does on narrow screens.
 */
const SIDEBAR_ROOM = 48 + 24 + 320 + 32 + 16

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

/**
 * The `@page` rules for printing, kept in a <style> element of its own: the sheet size and
 * margins follow the document's page setup (see pageRules).
 */
function usePrintPageRules(rules: string) {
  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.pageRule = ''
    style.textContent = rules
    document.head.append(style)
    return () => style.remove()
  }, [rules])
}

/**
 * A phone's keyboard: Android resizes the layout for it (`interactive-widget=resizes-content` in
 * index.html); iOS doesn't, and the shell (100dvh) would run under the keyboard, status bar and
 * caret included. While the visible viewport is clearly shorter than the window (and not because
 * of a pinch zoom), the shell takes its height (`--app-height`, see App.css).
 */
function useKeyboardHeight() {
  useEffect(() => {
    const visual = window.visualViewport
    if (!visual) return
    const root = document.documentElement
    const update = () => {
      const covered = visual.scale < 1.01 && window.innerHeight - visual.height > 80
      if (covered) root.style.setProperty('--app-height', `${Math.round(visual.height)}px`)
      else root.style.removeProperty('--app-height')
    }
    update()
    visual.addEventListener('resize', update)
    return () => {
      visual.removeEventListener('resize', update)
      root.style.removeProperty('--app-height')
    }
  }, [])
}

/** Space the page keeps on screen: the editor's padding around it (see layout.css). */
const PAGE_PADDING = { x: 48, top: 16, bottom: 16 }

/** Keys that scroll a page, and how far: a fraction of the view's height, or to an end. */
const SCROLL_KEYS: Record<string, (view: HTMLElement, shift: boolean) => number> = {
  PageDown: (v) => v.clientHeight * 0.875,
  PageUp: (v) => -v.clientHeight * 0.875,
  ' ': (v, shift) => (shift ? -1 : 1) * v.clientHeight * 0.875,
  ArrowDown: () => 40,
  ArrowUp: () => -40,
  End: (v) => v.scrollHeight,
  Home: (v) => -v.scrollHeight,
}

/**
 * Registers the document scroller (see editor/scroller.ts) and publishes its height as
 * `--doc-view-height`, for the sticky sidebar's own scrolling (see App.css).
 *
 * The page itself doesn't scroll, so scrolling keys pressed with nothing focused would do
 * nothing. The scroller is focusable (tabIndex -1) and takes focus when the page opens with
 * nothing else focused; keys that still reach the body (after a dialog closes, say) scroll it too.
 */
function useDocumentScroller(view: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!view) return
    setDocumentScroller(view)
    if (!document.activeElement || document.activeElement === document.body) view.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      const distance = SCROLL_KEYS[event.key]
      if (!distance || event.defaultPrevented || event.target !== document.body) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      view.focus({ preventScroll: true })
      view.scrollBy({ top: distance(view, event.shiftKey) })
    }
    window.addEventListener('keydown', onKey)
    const observer = new ResizeObserver(() => view.style.setProperty('--doc-view-height', `${view.clientHeight}px`))
    observer.observe(view)
    return () => {
      observer.disconnect()
      window.removeEventListener('keydown', onKey)
      setDocumentScroller(null)
    }
  }, [view])
}

/**
 * The percentage a fit (Page width, One page) gives, following the window and the sidebar. The
 * room is the main column's width (which doesn't depend on the zoom while fitting: see the
 * `--layout-page-width` below) and the document scroller's height.
 */
function useFitZoom(
  fit: ZoomFit | null,
  pageWidth: number,
  pageHeight: number,
  main: RefObject<HTMLElement | null>,
  view: HTMLElement | null,
): number | null {
  const [fitted, setFitted] = useState<number | null>(null)
  useLayoutEffect(() => {
    const column = main.current
    if (!fit || !column || !view) return
    const measure = () => {
      const width = column.clientWidth - PAGE_PADDING.x
      const height = view.clientHeight - PAGE_PADDING.top - PAGE_PADDING.bottom
      setFitted(fitZoom({ fit, pageWidth, pageHeight, width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    observer.observe(view)
    return () => observer.disconnect()
  }, [fit, pageWidth, pageHeight, main, view])
  return fit ? fitted : null
}

/**
 * Zooming keeps the same place in the document in the middle of the scroller, as Word does,
 * instead of the same scroll offset. The scroll position is remembered before each change, since
 * the browser's own scroll anchoring may already have moved it by the time this runs.
 */
function useZoomAnchor(zoom: number, editor: Editor, view: HTMLElement | null) {
  const before = useRef({ zoom, scrollTop: 0 })
  useEffect(() => {
    if (!view) return
    const remember = () => (before.current.scrollTop = view.scrollTop)
    remember()
    view.addEventListener('scroll', remember, { passive: true })
    return () => view.removeEventListener('scroll', remember)
  }, [view])
  useLayoutEffect(() => {
    const previous = before.current
    if (!view || previous.zoom === zoom) return
    const middle = view.clientHeight / 2
    // The editor's top in the scroller's content, which zooming doesn't move.
    const top = editor.view.dom.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop
    const offset = (previous.scrollTop + middle - top) / previous.zoom
    before.current = { zoom, scrollTop: previous.scrollTop }
    if (offset > 0) view.scrollTo({ top: top + offset * zoom - middle, behavior: 'instant' })
  }, [zoom, editor, view])
}

type WorkspaceProps = { session: Session; template: Template | undefined; role: Role | null }

function Workspace({ session, template, role }: WorkspaceProps) {
  const me = useMe()
  const [user] = useState(() => collabUser(me.email))
  // Only owners and editors write. Viewers, and anyone whose role isn't known yet, read.
  const canWrite = canWriteAs(role)
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
  const getEditor = useCallback(() => editorRef.current, [])

  // Print layout shows pages; Web layout, or a screen too narrow for a page, one continuous page.
  // Printing doesn't use either: the browser paginates with the page setup (see pageRules).
  const pageSetup = usePageSetup(session)
  const paged = usePagedView()
  const pagination = useMemo(() => ({ enabled: paged, ...pageGeometry(pageSetup) }), [paged, pageSetup])
  usePrintPageRules(pageRules(pageSetup))

  const backupTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    canWriteRef.current = canWrite
    if (!canWrite) window.clearTimeout(backupTimer.current)
  }, [canWrite])

  // A backup made in this browser before documents had owners belongs to the owner.
  useEffect(() => {
    if (role === 'owner') adoptLegacyBackup(me.email, session.name)
  }, [role, me.email, session.name])

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
      pagination,
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

  // Page setup changes are steps in the editor's undo history (see `trackPageSetupUndo`).
  useEffect(() => {
    const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
    if (undoManager) trackPageSetupUndo(session, undoManager)
  }, [editor, session])

  useEffect(() => {
    editor.commands.showInvisibleCharacters(view.invisibles)
  }, [editor, view.invisibles])

  // Before paint, so switching layouts or page sizes doesn't flash the old one.
  useLayoutEffect(() => {
    editor.commands.setPagination(pagination)
  }, [editor, pagination])

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

  const [sharing, setSharing] = useState(false)

  const mainRef = useRef<HTMLElement>(null)
  // The document's scroller, as state: the menus and the zoom need it once it exists.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useDocumentScroller(scroller)
  useKeyboardHeight()

  // Zoom: a percentage, or a fit in Print layout. Printing is always at 100% (print CSS).
  const zoomSetting = useZoomSetting()
  const fit = paged ? zoomSetting.fit : null
  const fitted = useFitZoom(fit, pagination.pageWidth, pagination.pageHeight, mainRef, scroller)
  const zoom = fit ? (fitted ?? 100) : zoomSetting.percent
  useZoomAnchor(zoom, editor, scroller)
  // Room for the sidebar beside the page at 100%. Zoomed in further, the page scrolls sideways in
  // the document area instead (like a landscape page wider than the window): the contents stay.
  const sidebarFits = useMediaQuery(`(min-width: ${Math.ceil(pagination.pageWidth) + SIDEBAR_ROOM}px)`)

  const canToggleReadOnly = canWrite && !closedWhileOpen
  const chrome = useMemo<DocumentChrome>(
    () => ({
      role,
      view: { ...view, readOnly },
      canToggleReadOnly,
      setView: (next) => setView((prev) => ({ ...prev, ...next })),
      backup: () => backup(editor),
      share: () => setSharing(true),
      zoom,
    }),
    [role, view, readOnly, canToggleReadOnly, backup, editor, zoom],
  )

  const style = {
    '--zoom': zoom / 100,
    // The page's width on screen, which the main column makes room for. Not while fitting: the
    // page then fits the column by definition, and the column must not follow the page.
    '--layout-page-width': fit ? '0px' : `${(pagination.pageWidth * zoom) / 100}px`,
  } as CSSProperties

  const classes = [
    'app',
    'doc-shell',
    view.focusMode && 'focus-mode',
    readOnly && 'read-only',
    !view.sidebar && 'no-sidebar',
    paged && 'layout-print',
    paged && view.sidebar && !sidebarFits && 'sidebar-below',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <DocumentChromeContext value={chrome}>
      <div className={classes} style={style}>
        <Ribbon
          editor={editor}
          session={session}
          readOnly={readOnly}
          start={<DocumentTitle session={session} />}
          end={<BarActions presence={presence} />}
        />
        {sharing && <ShareDialog docId={session.name} onClose={() => setSharing(false)} />}
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
            you reload: copy them, or export them from the File tab, if you need them.
          </div>
        )}
        {!closed && <SessionBanner keepsChanges onSignedIn={reconnect} />}
        {/* The only part of the page that scrolls: the ribbon above and the status bar below stay put. */}
        <div className="doc-scroll" ref={setScroller} tabIndex={-1}>
          <div className="workspace">
            <main className="main" ref={mainRef}>
              <h1 className="sr-only">{title || 'Untitled document'}</h1>
              <div className="editor-shell" data-tour="editor">
                <EditorContent editor={editor} className="editor" />
                <EditorMenus editor={editor} scrollTarget={scroller} />
              </div>
            </main>
            {view.sidebar && <Sidebar editor={editor} toc={toc} />}
          </div>
        </div>
        <Toast />
        <StatusBar
          editor={editor}
          status={status}
          pending={pending}
          retrying={retrying}
          readOnly={view.readOnly && canWrite}
          role={role}
          zoom={zoom}
        />
      </div>
    </DocumentChromeContext>
  )
}
