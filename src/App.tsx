import { isChangeOrigin } from '@tiptap/extension-collaboration'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { EditorMenus } from './components/EditorMenus'
import { Header, type ViewOptions } from './components/Header'
import { Sidebar, type EditorEvent } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { saveBackup } from './editor/backup'
import { isSharedDocEmpty, loadUser, provider, saveUser, seedSharedDoc, type CollabUser } from './editor/collab'
import { initialContent } from './editor/content'
import { buildExtensions } from './editor/extensions'
import { useConnectionStatus, usePresence } from './editor/hooks'
import { hasSeenWelcomeTour, startTour } from './tours'

/** How long to wait for the collaboration server before opening the editor offline. */
const SYNC_TIMEOUT_MS = 4000

/**
 * Waits for the first sync with the collaboration server, so the editor never
 * writes its own empty document into the shared one before seeing the real content.
 */
function useInitialSync(): { ready: boolean; seed: boolean } {
  const [state, setState] = useState(() =>
    provider.isSynced ? { ready: true, seed: isSharedDocEmpty() } : { ready: false, seed: false },
  )

  useEffect(() => {
    if (state.ready) return
    const onSynced = ({ state: synced }: { state: boolean }) => {
      if (synced) setState({ ready: true, seed: isSharedDocEmpty() })
    }
    // Offline: open the editor anyway; edits merge once the server is reachable.
    // Never seed in this case, or the demo content would be duplicated on reconnect.
    const timer = window.setTimeout(() => setState({ ready: true, seed: false }), SYNC_TIMEOUT_MS)
    provider.on('synced', onSynced)
    return () => {
      window.clearTimeout(timer)
      provider.off('synced', onSynced)
    }
  }, [state.ready])

  return state
}

export default function App() {
  const { ready, seed } = useInitialSync()

  if (!ready) {
    return (
      <div className="loading" role="status">
        <span className="spinner" aria-hidden />
        Connecting to the shared document…
      </div>
    )
  }

  return <Workspace seed={seed} />
}

const MAX_EVENTS = 50

function Workspace({ seed }: { seed: boolean }) {
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
      user,
      getEditor,
      onTableOfContents: (data) => queueMicrotask(() => setToc(data)),
    })
    // First visitor to a brand-new document gets the demo content, written to
    // Yjs before the editor binds to it.
    if (seed) seedSharedDoc(initialContent, list)
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
      backupTimer.current = window.setTimeout(() => saveBackup(e), 1000)
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
    editor.setEditable(!view.readOnly)
  }, [editor, view.readOnly])

  useEffect(() => {
    editor.commands.showInvisibleCharacters(view.invisibles)
  }, [editor, view.invisibles])

  // Tutorial overlays: auto-start once, and `?` replays the welcome tour.
  useEffect(() => {
    const timer = hasSeenWelcomeTour() ? undefined : window.setTimeout(() => startTour('welcome'), 700)
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
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const presence = usePresence()
  const status = useConnectionStatus()

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
        presence={presence}
        view={view}
        onViewChange={(next) => setView((prev) => ({ ...prev, ...next }))}
      />
      <div className="workspace">
        <main className="main">
          <Toolbar editor={editor} readOnly={view.readOnly} />
          <div className="editor-shell" data-tour="editor">
            <EditorContent editor={editor} className="editor" />
            <EditorMenus editor={editor} />
          </div>
        </main>
        {view.sidebar && <Sidebar editor={editor} toc={toc} events={events} onClearEvents={() => setEvents([])} />}
      </div>
      <StatusBar editor={editor} user={user} onRename={rename} status={status} readOnly={view.readOnly} />
    </div>
  )
}
