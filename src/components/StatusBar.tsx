import { useEditorState, type Editor } from '@tiptap/react'
import { FileText, Globe, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Role } from '../api'
import { BACKUP_EVENT, loadBackup, type Backup } from '../editor/backup'
import { CHARACTER_LIMIT } from '../editor/extensions'
import type { ConnectionStatus } from '../editor/hooks'
import { setLayoutMode, useLayoutMode, useNarrowScreen, type LayoutMode } from '../editor/page-setup'
import { ZoomSlider } from './ZoomControls'

type StatusBarProps = {
  editor: Editor
  documentName: string
  /** The signed-in User, whose local backup is shown. */
  email: string
  status: ConnectionStatus
  /** Changes the server hasn't confirmed for a while (see `usePendingChanges`). */
  pending: boolean
  /** The server can't check who we are right now; the tab retries (see `useRetrying`). */
  retrying: boolean
  /** The Read-only view preference (owners and editors). */
  readOnly: boolean
  /** Viewers see "View only"; only owners and editors take backups. `null` while unknown. */
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

export function StatusBar({ editor, documentName, email, status, pending, retrying, readOnly, role, zoom }: StatusBarProps) {
  const viewer = role === 'viewer'
  const canWrite = role === 'owner' || role === 'editor'
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from, from, to } = e.state.selection
      return {
        words: e.storage.characterCount.words(),
        characters: e.storage.characterCount.characters(),
        node: $from.parent.type.name,
        from,
        to,
      }
    },
  })

  const stored = useMemo(() => loadBackup(email, documentName)?.savedAt ?? null, [email, documentName])
  const [newest, setSavedAt] = useState<number | null>(null)
  const savedAt = newest ?? stored

  useEffect(() => {
    const onSaved = (event: Event) => setSavedAt((event as CustomEvent<Backup>).detail.savedAt)
    window.addEventListener(BACKUP_EVENT, onSaved)
    return () => window.removeEventListener(BACKUP_EVENT, onSaved)
  }, [])

  // "Synced" only when the server has also confirmed our changes, not just when connected.
  const unsaved = !retrying && status === 'connected' && pending
  const label = retrying
    ? 'Can’t confirm your sign-in right now: retrying…'
    : unsaved
      ? viewer
        ? 'Not saved: view only'
        : 'Saving…'
      : STATUS_LABEL[status]
  const percent = Math.min(100, Math.round((info.characters / CHARACTER_LIMIT) * 100))

  return (
    <footer className="status-bar" data-tour="status">
      <span
        className={`status-item${info.characters > CHARACTER_LIMIT ? ' over-limit' : ''}`}
        title={`${info.characters} characters (soft limit ${CHARACTER_LIMIT})`}
      >
        <span className="meter" aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </span>
        {info.words.toLocaleString()} words · {info.characters.toLocaleString()} / {CHARACTER_LIMIT.toLocaleString()}
      </span>
      <span className="status-item muted status-position" title="Updated on every selection change">
        {info.node} @ {info.from === info.to ? info.from : `${info.from}–${info.to}`}
      </span>
      {viewer ? (
        <span className="status-item badge" data-tour="view-only" title="Your share lets you read, copy and export this document">
          View only
        </span>
      ) : (
        readOnly && <span className="status-item badge">Read-only</span>
      )}
      <span className="status-spacer" />
      {canWrite && (
        <span className="status-item muted status-detail">
          {savedAt ? `Backup ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'No backup yet'}
        </span>
      )}
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
