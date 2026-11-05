import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { Collaboration, isChangeOrigin } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import { FileHandler } from '@tiptap/extension-file-handler'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { InvisibleCharacters } from '@tiptap/extension-invisible-characters'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Mention } from '@tiptap/extension-mention'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TableOfContents, type TableOfContentData } from '@tiptap/extension-table-of-contents'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Typography } from '@tiptap/extension-typography'
import { UniqueID } from '@tiptap/extension-unique-id'
import { Youtube } from '@tiptap/extension-youtube'
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import type { Editor, Extensions } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { presenceLabel } from '../identity'
import type { CollabUser, Session } from './collab'
import { Callout } from './extensions/callout'
import { Pagination, type PaginationOptions } from './extensions/pagination/Pagination'
import { tocScrollParent } from './scroller'
import { Shortcuts } from './extensions/shortcuts'
import { SlashCommand } from './extensions/slash-command'
import { Spoiler } from './extensions/spoiler'
import { emojiSuggestion, mentionSuggestion } from './suggestions'

/** Soft limit shown in the status bar. Not enforced: a hard limit would also reject collaborators' changes. */
export const CHARACTER_LIMIT = 50_000
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']

export const lowlight = createLowlight(common)

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
  const content = sources.map((src, i) => ({ type: 'image', attrs: { src, alt: accepted[i].name } }))
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
  /** Initial page layout; it changes later through `setPagination`. */
  pagination: PaginationOptions
}

export function buildExtensions({ session, user, onSave, getEditor, onTableOfContents, pagination }: Options): Extensions {
  return [
    StarterKit.configure({
      // Yjs has its own history; the regular undo/redo would fight it.
      undoRedo: false,
      // Replaced by CodeBlockLowlight below.
      codeBlock: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),

    // Collaboration
    Collaboration.configure({ document: session.ydoc }),
    CollaborationCaret.configure({ provider: session.provider, user, render: renderCaret }),

    // Small additions
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
        if (node.type.name === 'detailsSummary') return 'Summary'
        return "Type '/' for commands, '@' to mention, ':' for emoji…"
      },
      includeChildren: true,
    }),
    CharacterCount,
    Focus.configure({ className: 'has-focus', mode: 'deepest' }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TextStyleKit,
    Subscript,
    Superscript,
    Typography,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({
      allowBase64: true,
      resize: {
        enabled: true,
        directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        minWidth: 80,
        minHeight: 40,
        alwaysPreserveAspectRatio: true,
      },
    }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Youtube.configure({ nocookie: true, width: 640, height: 360 }),
    Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true, suggestion: emojiSuggestion }),
    InvisibleCharacters.configure({ visible: false }),
    UniqueID.configure({
      // TableOfContents already owns the `id` attribute on headings; keep these separate.
      attributeName: 'uid',
      types: ['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'callout', 'details'],
      // Don't re-assign IDs for changes that came from other collaborators.
      filterTransaction: (transaction) => !isChangeOrigin(transaction),
    }),

    // UI & interaction
    Mention.configure({ HTMLAttributes: { class: 'mention' }, suggestion: mentionSuggestion }),
    SlashCommand,
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
    FileHandler.configure({
      allowedMimeTypes: IMAGE_TYPES,
      onDrop: (editor, files, pos) => void insertImageFiles(editor, files, pos),
      onPaste: (editor, files, htmlContent) => {
        // Pasted HTML that already contains the image is handled by the Image extension.
        if (htmlContent) return
        void insertImageFiles(editor, files)
      },
    }),
    TableOfContents.configure({
      onUpdate: onTableOfContents,
      // The document scrolls in its own element, not the window (see scroller.ts).
      scrollParent: () => tocScrollParent as unknown as HTMLElement,
    }),

    // Content & API
    Markdown,
    Callout,
    Spoiler,
    Shortcuts.configure({ onSave }),
    Pagination.configure(pagination),

    // Bigger lifts
    Mathematics.configure({
      katexOptions: { throwOnError: false },
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
