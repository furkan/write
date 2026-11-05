import type { Editor } from '@tiptap/react'
import {
  ArchiveRestore,
  Copy,
  FileCode,
  FileDown,
  FileJson,
  FileText,
  FilePlus2,
  FileUp,
  FolderOpen,
  Printer,
  RotateCcw,
  Save,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { createDoc, docUrl, duplicateDoc, libraryUrl, trashDoc } from '../../api'
import { loadBackup } from '../../editor/backup'
import { getTitle, type Session } from '../../editor/collab'
import { initialContent } from '../../editor/content'
import { downloadPdf, usePreparingPdf } from '../../editor/pdf'
import { mod } from '../../editor/platform'
import { useMe } from '../../session'
import { RibbonButton, RibbonGroup } from './controls'
import { canWrite, useDocumentChrome } from './documentContext'
import type { TabProps } from './editorState'

const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document'

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Asks for a file without a mounted <input>: the ribbon's flyout (or this tab) may close while the
 * file picker is open, and the choice must still arrive.
 */
function pickFile(accept: string, onPick: (file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) onPick(file)
  })
  input.click()
}

async function newDocument() {
  try {
    const doc = await createDoc()
    window.location.assign(docUrl(doc.id))
  } catch {
    window.alert('Could not create a document. Is the server running?')
  }
}

async function makeCopy(session: Session) {
  try {
    const copy = await duplicateDoc(session.name)
    window.location.assign(docUrl(copy.id))
  } catch {
    window.alert('Could not copy this document yet. Try again after making an edit.')
  }
}

// Reversible, so no confirmation: the library shows an "Undo" toast.
async function moveToTrash(session: Session) {
  try {
    await trashDoc(session.name)
  } catch {
    window.alert('Could not move the document to the trash. Is the server running?')
    return
  }
  window.location.assign(libraryUrl(session.name))
}

async function importMarkdown(editor: Editor, file: File) {
  const text = await file.text()
  if (!window.confirm(`Replace the shared document with “${file.name}”? Everyone connected will see the change.`)) return
  editor.commands.setContent(text, { contentType: 'markdown' })
}

/**
 * Word's File tab as a ribbon panel: new and copy, the library, print and Download as PDF, share,
 * import and export, local backups and the trash. Viewers keep what doesn't change the document
 * (copy, export, print, PDF); actions that would are hidden for them, and disabled in Read-only.
 */
export function FileTab({ editor, session }: TabProps) {
  const me = useMe()
  const { role, view, backup, share } = useDocumentChrome()
  const writer = canWrite(role)
  const isOwner = role === 'owner'
  const baseName = () => fileSafe(getTitle(session) || 'Untitled document')
  const preparingPdf = usePreparingPdf()

  const restoreBackup = () => {
    const saved = loadBackup(me.email, session.name)
    if (!saved) {
      window.alert('No local backup found yet. Backups are saved automatically as you type.')
      return
    }
    const when = new Date(saved.savedAt).toLocaleString()
    if (window.confirm(`Restore your local backup from ${when}? This replaces the shared document for everyone.`)) {
      editor.commands.setContent(saved.content)
    }
  }

  const resetDemo = () => {
    if (window.confirm('Replace the shared document with the demo content? Everyone connected will see the change.')) {
      editor.commands.setContent(initialContent)
    }
  }

  return (
    <>
      <RibbonGroup label="New">
        <div className="ribbon-row">
          <RibbonButton size="large" label="New document" icon={FilePlus2} onClick={() => void newDocument()} />
          <RibbonButton size="large" label="Make a copy" icon={Copy} onClick={() => void makeCopy(session)} />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Open">
        <RibbonButton size="large" label="All documents" icon={FolderOpen} onClick={() => window.location.assign(libraryUrl())} />
      </RibbonGroup>

      <RibbonGroup label="Print and PDF" tour="print">
        <div className="ribbon-row">
          {/* The browser's dialog, as Ctrl/Cmd+P: the sheets follow the page setup (pageRules). */}
          <RibbonButton
            size="large"
            label="Print"
            title="Print with the browser’s dialog"
            shortcut={`${mod}+P`}
            icon={Printer}
            onClick={() => window.print()}
          />
          {/* Made on the server: no browser headers, the same from every browser (server/pdf.ts). */}
          <RibbonButton
            size="large"
            label={preparingPdf ? 'Preparing PDF…' : 'Download as PDF'}
            title="Download a PDF with this document’s page setup"
            icon={FileText}
            busy={preparingPdf}
            onClick={() => void downloadPdf(session)}
          />
        </div>
      </RibbonGroup>

      <RibbonGroup label="Share">
        <RibbonButton
          size="large"
          label={isOwner ? 'Share' : 'Who has access'}
          title={isOwner ? 'Share this document' : 'See who has access'}
          icon={isOwner ? UserPlus : Users}
          onClick={share}
        />
      </RibbonGroup>

      <RibbonGroup label="Import and export" tour="file-export">
        <div className="ribbon-row">
          {writer && (
            <RibbonButton
              size="large"
              label="Import Markdown"
              icon={FileUp}
              disabled={view.readOnly}
              onClick={() => pickFile('.md,.markdown,text/markdown,text/plain', (file) => void importMarkdown(editor, file))}
            />
          )}
          <div className="ribbon-stack">
            <RibbonButton
              size="medium"
              label="Export Markdown"
              icon={FileDown}
              onClick={() => download(`${baseName()}.md`, editor.getMarkdown(), 'text/markdown')}
            />
            <RibbonButton
              size="medium"
              label="Export HTML"
              icon={FileCode}
              onClick={() => download(`${baseName()}.html`, editor.getHTML(), 'text/html')}
            />
            <RibbonButton
              size="medium"
              label="Export JSON"
              icon={FileJson}
              onClick={() => download(`${baseName()}.json`, JSON.stringify(editor.getJSON(), null, 2), 'application/json')}
            />
          </div>
        </div>
      </RibbonGroup>

      {writer && (
        <RibbonGroup label="Local backup">
          <div className="ribbon-stack">
            <RibbonButton size="medium" label="Save backup" shortcut={`${mod}+S`} icon={Save} onClick={backup} />
            <RibbonButton size="medium" label="Restore backup…" icon={ArchiveRestore} disabled={view.readOnly} onClick={restoreBackup} />
            <RibbonButton size="medium" label="Reset to demo…" icon={RotateCcw} disabled={view.readOnly} onClick={resetDemo} />
          </div>
        </RibbonGroup>
      )}

      {isOwner && (
        <RibbonGroup label="Trash">
          <RibbonButton size="large" tone="danger" label="Move to trash" icon={Trash2} onClick={() => void moveToTrash(session)} />
        </RibbonGroup>
      )}
    </>
  )
}
