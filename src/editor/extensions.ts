import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { FileHandler } from '@tiptap/extension-file-handler'
import { InvisibleCharacters } from '@tiptap/extension-invisible-characters'
import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { Typography } from '@tiptap/extension-typography'
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { ReactNodeViewRenderer, type Editor, type Extensions } from '@tiptap/react'
import { presenceLabel } from '../identity'
import type { CollabUser, Session } from './collab'
import { PAGE_SETUP_ORIGIN } from './page-setup'
import { CalloutView } from './extensions/CalloutView'
import { documentExtensions } from './schema'
import { Pagination, type PaginationOptions } from './extensions/pagination/Pagination'
import { ZoomedResize } from './extensions/ZoomedResize'
import { tocScrollParent } from './scroller'
import { Shortcuts } from './extensions/shortcuts'
import { SlashCommand } from './extensions/slash-command'
import { emojiSuggestion, mentionSuggestion } from './suggestions'

const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

export { lowlight } from './schema'

const readAsDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

/** Reads dropped/pasted image files and inserts them, in order, as data-URL images. */
async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  const accepted = files.filter((file) => {
    if (file.size <= MAX_IMAGE_BYTES) return true
    window.alert(`“${file.name}” is larger than 2 MB. Use an image URL instead.`)
    return false
  })
  if (!accepted.length) return
  const sources = await Promise.all(accepted.map(readAsDataURL))
  if (editor.isDestroyed) return
  const content = sources.map((src) => ({ type: 'image', attrs: { src, alt: '' } }))
  if (pos === undefined) {
    editor.chain().focus().insertContent(content).run()
    return
  }
  // Reading is async and collaborators may have edited meanwhile, so keep the drop point in range.
  const at = Math.min(pos, editor.state.doc.content.size)
  editor.chain().focus().insertContentAt(at, content).run()
}

function editMath(editor: Editor, kind: 'inline' | 'block', latex: string, pos: number) {
  const next = window.prompt(`Edit ${kind} LaTeX`, latex)
  if (next === null) return
  if (kind === 'inline') editor.chain().updateInlineMath({ latex: next, pos }).focus().run()
  else editor.chain().updateBlockMath({ latex: next, pos }).focus().run()
}

/**
 * A collaborator's caret: the Caret label (their email's local part) with the full email as a
 * tooltip. Presence is client-reported, so everything here is treated as untrusted text.
 */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const email = typeof user.email === 'string' ? user.email : ''
  const name = presenceLabel(user)
  const color = typeof user.color === 'string' ? user.color : 'transparent'
  const caret = document.createElement('span')
  caret.classList.add('collaboration-carets__caret')
  caret.style.borderColor = color
  const label = document.createElement('div')
  label.classList.add('collaboration-carets__label')
  label.style.backgroundColor = color
  label.textContent = name.slice(0, 64)
  if (email) label.title = email
  caret.append(label)
  return caret
}

type Options = {
  session: Session
  user: CollabUser
  onSave: (editor: Editor) => void
  getEditor: () => Editor | null
  onTableOfContents: (data: TableOfContentData) => void
  /** Initial page layout (the gap between pages keeps its default); it changes later through `setPagination`. */
  pagination: Omit<PaginationOptions, 'pageGap'>
}

/**
 * The editor's extensions: the document's schema (`schema.ts`, shared with the server's PDF
 * export) plus everything interactive: collaboration, suggestions, node views and click handlers.
 */
export function buildExtensions({ session, user, onSave, getEditor, onTableOfContents, pagination }: Options): Extensions {
  const schema = documentExtensions()
  return [
    schema.starterKit,

    // Collaboration
    Collaboration.configure({
      document: session.ydoc,
      // Page setup changes (in `meta`) are undo steps too; see page-setup.ts.
      yUndoOptions: { trackedOrigins: [PAGE_SETUP_ORIGIN] },
    }),
    CollaborationCaret.configure({ provider: session.provider, user, render: renderCaret }),

    // Small additions
    Placeholder.configure({
      placeholder: ({ editor, node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        if (node.type.name === 'detailsSummary') return 'Summary'
        // Like Word: a hint only in a completely empty document, none on every empty line.
        return editor.isEmpty ? 'Start writing, or type / to insert' : ''
      },
      includeChildren: true,
    }),
    CharacterCount,
    Focus.configure({ className: 'has-focus', mode: 'deepest' }),
    schema.textAlign,
    schema.highlight,
    schema.textStyle,
    schema.subscript,
    schema.superscript,
    Typography,
    schema.taskList,
    schema.taskItem,
    schema.image,
    schema.table,
    schema.details,
    schema.detailsSummary,
    schema.detailsContent,
    schema.youtube,
    schema.emoji.configure({ suggestion: emojiSuggestion }),
    InvisibleCharacters.configure({ visible: false }),
    schema.uniqueId,

    // UI & interaction
    schema.mention.configure({ suggestion: mentionSuggestion }),
    SlashCommand,
    schema.codeBlock,
    FileHandler.configure({
      allowedMimeTypes: IMAGE_TYPES,
      onDrop: (editor, files, pos) => void insertImageFiles(editor, files, pos),
      onPaste: (editor, files, htmlContent) => {
        // Pasted HTML that already contains the image is handled by the Image extension.
        if (htmlContent) return
        void insertImageFiles(editor, files)
      },
    }),
    schema.tableOfContents.configure({
      onUpdate: onTableOfContents,
      // The document scrolls in its own element, not the window (see scroller.ts).
      scrollParent: () => tocScrollParent as unknown as HTMLElement,
    }),

    // Content & API
    Markdown,
    schema.callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
    schema.spoiler,
    Shortcuts.configure({ onSave }),
    // Math is edited by clicking it; Enter on a selected math node (reached with the keyboard) does the same.
    Extension.create({
      name: 'mathEnter',
      priority: 1000,
      addKeyboardShortcuts: () => ({
        Enter: ({ editor }) => {
          const sel = editor.state.selection
          if (!editor.isEditable || !(sel instanceof NodeSelection)) return false
          const name = sel.node.type.name
          if (name !== 'inlineMath' && name !== 'blockMath') return false
          editMath(editor, name === 'inlineMath' ? 'inline' : 'block', sel.node.attrs.latex, sel.from)
          return true
        },
      }),
    }),
    Pagination.configure(pagination),
    ZoomedResize,

    // Bigger lifts
    schema.mathematics.configure({
      inlineOptions: {
        onClick: (node, pos) => {
          const editor = getEditor()
          if (editor?.isEditable) editMath(editor, 'inline', node.attrs.latex, pos)
        },
      },
      blockOptions: {
        onClick: (node, pos) => {
          const editor = getEditor()
          if (editor?.isEditable) editMath(editor, 'block', node.attrs.latex, pos)
        },
      },
    }),
  ]
}
