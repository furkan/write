import { useEditorState, type Editor } from '@tiptap/react'
import { FileText, Globe, type LucideIcon } from 'lucide-react'
import type { Role } from '../api'
import type { ConnectionStatus } from '../editor/hooks'
import { setLayoutMode, useLayoutMode, useNarrowScreen, type LayoutMode } from '../editor/page-setup'
import { ZoomSlider } from './ZoomControls'

type StatusBarProps = {
  editor: Editor
  status: ConnectionStatus
  /** Changes the server hasn't confirmed for a while (see `usePendingChanges`). */
  pending: boolean
  /** The server can't check who we are right now; the tab retries (see `useRetrying`). */
  retrying: boolean
  /** The Read-only view preference (owners and editors). */
  readOnly: boolean
  /** Viewers see "View only". `null` while unknown. */
  role: Role | null
  /** The zoom shown now, in percent. */
  zoom: number
}

const LAYOUTS: { mode: LayoutMode; label: string; icon: LucideIcon }[] = [
  { mode: 'print', label: 'Print layout', icon: FileText },
  { mode: 'web', label: 'Web layout', icon: Globe },
]

/**
 * Word's view buttons: Print layout (pages) or Web layout (one continuous page), your own
 * preference. A narrow window always shows the document continuous, so they are off there and
 * say why (aria-disabled rather than disabled, so the tooltip still shows).
 */
function LayoutToggles() {
  const mode = useLayoutMode()
  const narrow = useNarrowScreen()
  return (
    <span className="status-item layout-toggles" role="group" aria-label="Layout" data-tour="layout-toggles">
      {LAYOUTS.map(({ mode: m, label, icon: Icon }) => (
        <button
          key={m}
          type="button"
          className={`status-toggle${mode === m && !narrow ? ' active' : ''}`}
          aria-pressed={narrow ? undefined : mode === m}
          aria-disabled={narrow || undefined}
          aria-label={label}
          title={narrow ? 'Narrow screens use continuous layout' : label}
          onClick={() => {
            if (!narrow) setLayoutMode(m)
          }}
        >
          <Icon aria-hidden size={14} />
        </button>
      ))}
    </span>
  )
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Synced',
  connecting: 'Connecting…',
  disconnected: 'Offline: changes will sync when you reconnect',
}

/**
 * Like Word's status bar: the word count (characters in its tooltip), whether you can edit, the
 * sync status, the layout buttons and the zoom. Nothing about the editor's internals.
 */
export function StatusBar({ editor, status, pending, retrying, readOnly, role, zoom }: StatusBarProps) {
  const viewer = role === 'viewer'
  const counts = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      words: e.storage.characterCount.words() as number,
      characters: e.storage.characterCount.characters() as number,
    }),
  })

  // "Synced" only when the server has also confirmed our changes, not just when connected.
  const unsaved = !retrying && status === 'connected' && pending
  const label = retrying
    ? 'Can’t confirm your sign-in right now: retrying…'
    : unsaved
      ? viewer
        ? 'Not saved: view only'
        : 'Saving…'
      : STATUS_LABEL[status]
  return (
    <footer className="status-bar" data-tour="status">
      <span className="status-item" title={`${counts.characters.toLocaleString()} ${counts.characters === 1 ? 'character' : 'characters'}`}>
        {counts.words.toLocaleString()} {counts.words === 1 ? 'word' : 'words'}
      </span>
      {viewer ? (
        <span className="status-item badge" data-tour="view-only" title="Your share lets you read, copy and export this document">
          View only
        </span>
      ) : (
        readOnly && <span className="status-item badge">Read-only</span>
      )}
      <span className="status-spacer" />
      <span
        className={`status-item connection ${retrying ? 'connecting' : status}${unsaved ? ' unsaved' : ''}`}
        data-tour="connection"
        role="status"
        title={retrying ? 'Cloudflare Access can’t check who you are at the moment. Keep typing: your changes sync once it can.' : undefined}
      >
        <span className="dot" aria-hidden />
        {label}
      </span>
      <LayoutToggles />
      <ZoomSlider zoom={zoom} />
    </footer>
  )
}
