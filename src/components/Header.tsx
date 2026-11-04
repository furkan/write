import type { Editor } from '@tiptap/react'
import { useRef, useState } from 'react'
import { loadBackup, saveBackup } from '../editor/backup'
import { documentName } from '../editor/collab'
import { initialContent } from '../editor/content'
import type { Presence } from '../editor/hooks'
import { startTour, TOURS, type TourId } from '../tours'
import { mod } from '../editor/platform'
import { Dropdown, MenuItem } from './Dropdown'

export type ViewOptions = {
  readOnly: boolean
  invisibles: boolean
  focusMode: boolean
  sidebar: boolean
}

type HeaderProps = {
  editor: Editor
  presence: Presence[]
  view: ViewOptions
  onViewChange: (next: Partial<ViewOptions>) => void
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Header({ editor, presence, view, onViewChange }: HeaderProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  const importMarkdown = async (file: File) => {
    const text = await file.text()
    if (!window.confirm(`Replace the shared document with “${file.name}”? Everyone connected will see the change.`)) return
    editor.commands.setContent(text, { contentType: 'markdown' })
  }

  const restoreBackup = () => {
    const backup = loadBackup()
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
        <span className="logo" aria-hidden>
          ✍️
        </span>
        <span className="brand-name">Write</span>
        <span className="doc-name" title="Shared document name (change with ?doc=name)">
          {documentName}
        </span>
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
                  download(`${documentName}.md`, editor.getMarkdown(), 'text/markdown')
                }}
              >
                Export Markdown
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  download(`${documentName}.html`, editor.getHTML(), 'text/html')
                }}
              >
                Export HTML
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  close()
                  download(`${documentName}.json`, JSON.stringify(editor.getJSON(), null, 2), 'application/json')
                }}
              >
                Export JSON
              </MenuItem>
              <hr />
              <MenuItem
                hint={`${mod}+S`}
                onSelect={() => {
                  close()
                  saveBackup(editor)
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

        <Dropdown label="?" title="Guided tours" tour="help" align="end" className="help">
          {(close) =>
            (Object.keys(TOURS) as TourId[]).map((id) => (
              <MenuItem
                key={id}
                onSelect={() => {
                  close()
                  // Let the menu close before driver.js measures the page.
                  requestAnimationFrame(() => startTour(id))
                }}
              >
                <span className="tour-item">
                  <strong>{TOURS[id].title}</strong>
                  <span className="muted small">{TOURS[id].summary}</span>
                </span>
              </MenuItem>
            ))
          }
        </Dropdown>
      </div>
    </header>
  )
}
