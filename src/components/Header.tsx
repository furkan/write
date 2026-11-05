import type { Editor } from '@tiptap/react'
import { useRef, useState } from 'react'
import { createDoc, docUrl, duplicateDoc, libraryUrl, trashDoc } from '../api'
import { loadBackup, saveBackup } from '../editor/backup'
import { setTitle, type Session } from '../editor/collab'
import { initialContent } from '../editor/content'
import { useDocTitle, type Presence } from '../editor/hooks'
import { mod } from '../editor/platform'
import { startTour, toursFor } from '../tours'
import { Dropdown, MenuItem } from './Dropdown'
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
  view: ViewOptions
  onViewChange: (next: Partial<ViewOptions>) => void
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

export function Header({ editor, session, presence, view, onViewChange }: HeaderProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)
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
    const backup = loadBackup(session.name)
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link', window.location.href)
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
      </div>

      <div className="header-actions">
        <div className="presence" data-tour="presence" aria-label={`${presence.length} people editing`}>
          {shown.map((person) => (
            <span
              key={person.clientId}
              className={`avatar${person.self ? ' self' : ''}`}
              style={{ background: person.color }}
              title={person.self ? `${person.name} (you)` : person.name}
            >
              {person.name.replace(/^Anonymous /, '').slice(0, 1).toUpperCase()}
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
                  window.location.assign(libraryUrl())
                }}
              >
                All documents
              </MenuItem>
              <hr />
              <MenuItem
                disabled={view.readOnly}
                onSelect={() => {
                  close()
                  fileInput.current?.click()
                }}
              >
                Import Markdown…
              </MenuItem>
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
              <hr />
              <MenuItem
                hint={`${mod}+S`}
                onSelect={() => {
                  close()
                  saveBackup(editor, session.name)
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
              <hr />
              <MenuItem
                disabled={view.readOnly}
                onSelect={() => {
                  close()
                  void moveToTrash()
                }}
              >
                <span className="danger-text">Move to trash</span>
              </MenuItem>
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
              <MenuItem active={view.readOnly} onSelect={() => onViewChange({ readOnly: !view.readOnly })}>
                {view.readOnly ? '✓ ' : ''}Read-only
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
            </>
          )}
        </Dropdown>

        <button type="button" className="header-button" data-tour="share" onClick={copyLink} title="Copy link to this document">
          {copied ? 'Copied ✓' : 'Share'}
        </button>

        <ThemeToggle />

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
