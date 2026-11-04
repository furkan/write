import { useEditorState, type Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { BACKUP_EVENT, loadBackup, type Backup } from '../editor/backup'
import type { CollabUser } from '../editor/collab'
import { CHARACTER_LIMIT } from '../editor/extensions'
import type { ConnectionStatus } from '../editor/hooks'

type StatusBarProps = {
  editor: Editor
  documentName: string
  user: CollabUser
  onRename: () => void
  status: ConnectionStatus
  readOnly: boolean
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Synced',
  connecting: 'Connecting…',
  disconnected: 'Offline: changes will sync when you reconnect',
}

export function StatusBar({ editor, documentName, user, onRename, status, readOnly }: StatusBarProps) {
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

  const [savedAt, setSavedAt] = useState<number | null>(() => loadBackup(documentName)?.savedAt ?? null)

  useEffect(() => {
    const onSaved = (event: Event) => setSavedAt((event as CustomEvent<Backup>).detail.savedAt)
    window.addEventListener(BACKUP_EVENT, onSaved)
    return () => window.removeEventListener(BACKUP_EVENT, onSaved)
  }, [])

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
      <span className="status-item muted" title="Updated on every selection change">
        {info.node} @ {info.from === info.to ? info.from : `${info.from}–${info.to}`}
      </span>
      {readOnly && <span className="status-item badge">Read-only</span>}
      <span className="status-spacer" />
      <span className="status-item muted">
        {savedAt ? `Backup ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'No backup yet'}
      </span>
      <span className={`status-item connection ${status}`} data-tour="connection" role="status">
        <span className="dot" aria-hidden />
        {STATUS_LABEL[status]}
      </span>
      <button type="button" className="status-item user-chip" data-tour="user" onClick={onRename} title="Change your name">
        <span className="dot" style={{ background: user.color }} aria-hidden />
        {user.name}
      </button>
    </footer>
  )
}
