import type { Editor } from '@tiptap/react'
import { useRef, useState } from 'react'
import { createDoc, docUrl, duplicateDoc, libraryUrl, trashDoc, type Role } from '../api'
import { loadBackup } from '../editor/backup'
import { setTitle, type Session } from '../editor/collab'
import { initialContent } from '../editor/content'
import { useDocTitle, type Presence } from '../editor/hooks'
import {
  MARGIN_PRESETS,
  ORIENTATIONS,
  PAPER_SIZES,
  setLayoutMode,
  setPageSetup,
  useLayoutMode,
  useNarrowScreen,
  usePageSetup,
  type PageSetup,
} from '../editor/page-setup'
import { mod } from '../editor/platform'
import { initialOf } from '../identity'
import { useMe } from '../session'
import { startTour, toursFor } from '../tours'
import { AccountMenu } from './AccountMenu'
import { Dropdown, MenuItem } from './Dropdown'
import { ShareDialog } from './ShareDialog'
import { ThemeToggle } from './ThemeToggle'

export type ViewOptions = {
  readOnly: boolean
  invisibles: boolean
  focusMode: boolean
  sidebar: boolean
}

type HeaderProps = {
  editor: Editor
  session: Session
  presence: Presence[]
  /** The caller's role; `null` while unknown (opened offline). */
  role: Role | null
  /** With `readOnly` already forced on for viewers and closed documents. */
  view: ViewOptions
  /** False for viewers (always read-only) and closed documents. */
  canToggleReadOnly: boolean
  onBackup: (editor: Editor) => void
  onViewChange: (next: Partial<ViewOptions>) => void
}

const entries = <K extends string, V>(record: Record<K, V>) => Object.entries(record) as [K, V][]

/**
 * Print or Web layout (yours) and the page setup (the document's, so only for people who can
 * edit it). Temporary home: these move to the ribbon's Layout tab.
 */
function LayoutMenuItems({ session, canEdit }: { session: Session; canEdit: boolean }) {
  const mode = useLayoutMode()
  const narrow = useNarrowScreen()
  const setup = usePageSetup(session)
  const choose = (change: Partial<PageSetup>) => setPageSetup(session, change)
  return (
    <>
      <hr />
      <MenuItem active={mode === 'print'} onSelect={() => setLayoutMode('print')}>
        {mode === 'print' ? '✓ ' : ''}Print layout{narrow ? ' (wider window)' : ''}
      </MenuItem>
      <MenuItem active={mode === 'web'} onSelect={() => setLayoutMode('web')}>
        {mode === 'web' ? '✓ ' : ''}Web layout
      </MenuItem>
      <hr />
      <div className="menu-label">Page size</div>
      {entries(PAPER_SIZES).map(([size, paper]) => (
        <MenuItem key={size} active={setup.size === size} disabled={!canEdit} hint={paper.detail} onSelect={() => choose({ size })}>
          {setup.size === size ? '✓ ' : ''}
          {paper.label}
        </MenuItem>
      ))}
      <div className="menu-label">Orientation</div>
      {entries(ORIENTATIONS).map(([orientation, { label }]) => (
        <MenuItem
          key={orientation}
          active={setup.orientation === orientation}
          disabled={!canEdit}
          onSelect={() => choose({ orientation })}
        >
          {setup.orientation === orientation ? '✓ ' : ''}
          {label}
        </MenuItem>
      ))}
      <div className="menu-label">Margins</div>
      {entries(MARGIN_PRESETS).map(([margins, preset]) => (
        <MenuItem
          key={margins}
          active={setup.margins === margins}
          disabled={!canEdit}
          hint={preset.detail}
          onSelect={() => choose({ margins })}
        >
          {setup.margins === margins ? '✓ ' : ''}
          {preset.label}
        </MenuItem>
      ))}
    </>
  )
}

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document'

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Google Docs-style title field bound to the shared document's `meta.title`. */
function TitleField({ session, readOnly }: { session: Session; readOnly: boolean }) {
  const title = useDocTitle(session)
  return (
    <input
      readOnly={readOnly}
      className="title-input"
      data-tour="title"
      aria-label="Document title"
      placeholder="Untitled document"
      value={title}
      size={Math.min(Math.max(title.length, 16), 48)}
      maxLength={200}
      onChange={(e) => setTitle(session, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

export function Header({ editor, session, presence, role, view, canToggleReadOnly, onBackup, onViewChange }: HeaderProps) {
  const me = useMe()
  const fileInput = useRef<HTMLInputElement>(null)
  const [sharing, setSharing] = useState(false)
  const isOwner = role === 'owner'
  const viewer = role === 'viewer'
  // Viewers, and anyone whose role isn't known yet, don't get the actions that change the document.
  const canWrite = role === 'owner' || role === 'editor'
  const title = useDocTitle(session)
  const baseName = fileSafe(title || 'Untitled document')

  const newDocument = async () => {
    try {
      const doc = await createDoc()
      window.location.assign(docUrl(doc.id))
    } catch {
      window.alert('Could not create a document. Is the server running?')
    }
  }

  const makeCopy = async () => {
    try {
      const copy = await duplicateDoc(session.name)
      window.location.assign(docUrl(copy.id))
    } catch {
      window.alert('Could not copy this document yet. Try again after making an edit.')
    }
  }

  // Reversible, so no confirmation: the library shows an "Undo" toast.
  const moveToTrash = async () => {
    try {
      await trashDoc(session.name)
    } catch {
      window.alert('Could not move the document to the trash. Is the server running?')
      return
    }
    window.location.assign(libraryUrl(session.name))
  }

  const importMarkdown = async (file: File) => {
    const text = await file.text()
    if (!window.confirm(`Replace the shared document with “${file.name}”? Everyone connected will see the change.`)) return
    editor.commands.setContent(text, { contentType: 'markdown' })
  }

  const restoreBackup = () => {
    const backup = loadBackup(me.email, session.name)
    if (!backup) {
      window.alert('No local backup found yet. Backups are saved automatically as you type.')
      return
    }
    const when = new Date(backup.savedAt).toLocaleString()
    if (window.confirm(`Restore your local backup from ${when}? This replaces the shared document for everyone.`)) {
      editor.commands.setContent(backup.content)
    }
  }

  const resetDemo = () => {
    if (window.confirm('Replace the shared document with the demo content? Everyone connected will see the change.')) {
      editor.commands.setContent(initialContent)
    }
  }

  const shown = presence.slice(0, 5)
  const extra = presence.length - shown.length

  return (
    <header className="header">
      <div className="brand">
        <a className="logo-link" href={libraryUrl()} title="All documents" data-tour="library-link">
          <span className="logo" aria-hidden>
            ✍️
          </span>
          <span className="visually-hidden">All documents</span>
        </a>
        <TitleField session={session} readOnly={view.readOnly} />
        {viewer && (
          <span className="view-only-badge" data-tour="view-only" title="You can read, copy and export this document, but not change it.">
            View only
          </span>
        )}
      </div>

      <div className="header-actions">
        <div className="presence" data-tour="presence" aria-label={`${presence.length} people editing`}>
          {shown.map((person) => (
            <span
              key={person.clientId}
              className={`avatar${person.self ? ' self' : ''}`}
              style={{ background: person.color }}
              title={`${person.email || person.name}${person.self ? ' (you)' : ''}`}
            >
              {initialOf(person.name)}
            </span>
          ))}
          {extra > 0 && <span className="avatar more">+{extra}</span>}
        </div>

        <Dropdown label="File" title="File" tour="file-menu" align="end">
          {(close) => (
            <>
              <MenuItem
                onSelect={() => {
                  close()
                  void newDocument()
                }}
              >
                New document
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  void makeCopy()
                }}
              >
                Make a copy
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  setSharing(true)
                }}
              >
                {isOwner ? 'Share…' : 'Who has access…'}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  window.location.assign(libraryUrl())
                }}
              >
                All documents
              </MenuItem>
              <hr />
              {/* Viewers can't change the document: actions that would are hidden, not disabled. */}
              {canWrite && (
                <MenuItem
                  disabled={view.readOnly}
                  onSelect={() => {
                    close()
                    fileInput.current?.click()
                  }}
                >
                  Import Markdown…
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  close()
                  download(`${baseName}.md`, editor.getMarkdown(), 'text/markdown')
                }}
              >
                Export Markdown
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  download(`${baseName}.html`, editor.getHTML(), 'text/html')
                }}
              >
                Export HTML
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  download(`${baseName}.json`, JSON.stringify(editor.getJSON(), null, 2), 'application/json')
                }}
              >
                Export JSON
              </MenuItem>
              {canWrite && (
                <>
                  <hr />
                  <MenuItem
                    hint={`${mod}+S`}
                    onSelect={() => {
                      close()
                      onBackup(editor)
                    }}
                  >
                    Save local backup
                  </MenuItem>
                  <MenuItem
                    disabled={view.readOnly}
                    onSelect={() => {
                      close()
                      restoreBackup()
                    }}
                  >
                    Restore local backup…
                  </MenuItem>
                  <MenuItem
                    disabled={view.readOnly}
                    onSelect={() => {
                      close()
                      resetDemo()
                    }}
                  >
                    Reset to demo content…
                  </MenuItem>
                </>
              )}
              {isOwner && (
                <>
                  <hr />
                  <MenuItem
                    onSelect={() => {
                      close()
                      void moveToTrash()
                    }}
                  >
                    <span className="danger-text">Move to trash</span>
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Dropdown>
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importMarkdown(file)
          }}
        />

        <Dropdown label="View" title="View" tour="view-menu" align="end">
          {() => (
            <>
              <MenuItem
                active={view.readOnly}
                disabled={!canToggleReadOnly}
                onSelect={() => onViewChange({ readOnly: !view.readOnly })}
              >
                {view.readOnly ? '✓ ' : ''}Read-only{viewer ? ' (view only)' : ''}
              </MenuItem>
              <MenuItem active={view.invisibles} onSelect={() => onViewChange({ invisibles: !view.invisibles })}>
                {view.invisibles ? '✓ ' : ''}Invisible characters
              </MenuItem>
              <MenuItem active={view.focusMode} onSelect={() => onViewChange({ focusMode: !view.focusMode })}>
                {view.focusMode ? '✓ ' : ''}Focus mode
              </MenuItem>
              <MenuItem active={view.sidebar} onSelect={() => onViewChange({ sidebar: !view.sidebar })}>
                {view.sidebar ? '✓ ' : ''}Sidebar
              </MenuItem>
              <LayoutMenuItems session={session} canEdit={canWrite && !view.readOnly} />
            </>
          )}
        </Dropdown>

        <button
          type="button"
          className="header-button"
          data-tour="share"
          onClick={() => setSharing(true)}
          title={isOwner ? 'Share this document' : 'See who has access'}
        >
          Share
        </button>
        {sharing && <ShareDialog docId={session.name} onClose={() => setSharing(false)} />}

        <ThemeToggle />
        <AccountMenu />

        <Dropdown label="?" title="Guided tours" tour="help" align="end" className="help">
          {(close) =>
            toursFor('document').map(([id, tour]) => (
              <MenuItem
                key={id}
                onSelect={() => {
                  close()
                  // Let the menu close before driver.js measures the page.
                  requestAnimationFrame(() => startTour(id))
                }}
              >
                <span className="tour-item">
                  <strong>{tour.title}</strong>
                  <span className="muted small">{tour.summary}</span>
                </span>
              </MenuItem>
            ))
          }
        </Dropdown>
      </div>
    </header>
  )
}
