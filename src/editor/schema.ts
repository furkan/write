import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Mention } from '@tiptap/extension-mention'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TableOfContents } from '@tiptap/extension-table-of-contents'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { UniqueID } from '@tiptap/extension-unique-id'
import { Youtube } from '@tiptap/extension-youtube'
import StarterKit from '@tiptap/starter-kit'
import { common, createLowlight } from 'lowlight'
import { Callout } from './extensions/callout.ts'
import { Spoiler } from './extensions/spoiler.ts'

/**
 * The document's schema: every node, mark and attribute the editor stores in the Y.Doc, configured
 * once for the editor (`extensions.ts`, which adds suggestions, node views and click handlers with
 * `.configure()`/`.extend()`) and for the server, which renders the stored document to HTML for
 * the PDF export (`server/pdf-html.ts`). So no React and no DOM in this module or what it imports.
 */

export const lowlight = createLowlight(common)

export const KATEX_OPTIONS = { throwOnError: false }

export function documentExtensions() {
  return {
    starterKit: StarterKit.configure({
      // Yjs has its own history; the regular undo/redo would fight it.
      undoRedo: false,
      // Replaced by CodeBlockLowlight below.
      codeBlock: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    textAlign: TextAlign.configure({ types: ['heading', 'paragraph'] }),
    highlight: Highlight.configure({ multicolor: true }),
    textStyle: TextStyleKit,
    subscript: Subscript,
    superscript: Superscript,
    taskList: TaskList,
    taskItem: TaskItem.configure({ nested: true }),
    image: Image.configure({
      allowBase64: true,
      resize: {
        enabled: true,
        directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        minWidth: 80,
        minHeight: 40,
        alwaysPreserveAspectRatio: true,
      },
    }),
    table: TableKit.configure({ table: { resizable: true } }),
    details: Details.configure({ persist: true }),
    detailsSummary: DetailsSummary,
    detailsContent: DetailsContent,
    youtube: Youtube.configure({ nocookie: true, width: 640, height: 360 }),
    emoji: Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true }),
    uniqueId: UniqueID.configure({
      // TableOfContents already owns the `id` attribute on headings; keep these separate.
      attributeName: 'uid',
      types: ['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'callout', 'details'],
      // Don't re-assign IDs for changes that came from other collaborators.
      filterTransaction: (transaction) => !isChangeOrigin(transaction),
    }),
    mention: Mention.configure({ HTMLAttributes: { class: 'mention' } }),
    codeBlock: CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
    tableOfContents: TableOfContents,
    callout: Callout,
    spoiler: Spoiler,
    mathematics: Mathematics.configure({ katexOptions: KATEX_OPTIONS }),
  }
}
