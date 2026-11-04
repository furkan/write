import type { Editor } from '@tiptap/react'
import { CALLOUT_VARIANTS, type CalloutVariant } from './extensions/callout-variants'

/**
 * Block-level insert actions shared by the slash menu, the floating "+" menu
 * and the toolbar's Insert menu.
 */
export type BlockAction = {
  id: string
  label: string
  icon: string
  hint?: string
  keywords?: string
  run: (editor: Editor) => void
}

const ask = (message: string, fallback = '') => {
  const value = window.prompt(message, fallback)
  return value?.trim() || null
}

export function setLink(editor: Editor) {
  const previous = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('Link URL (leave empty to remove)', previous ?? 'https://')
  if (url === null) return
  if (url.trim() === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
}

export function insertImage(editor: Editor) {
  const src = ask('Image URL', 'https://picsum.photos/800/400')
  if (src) editor.chain().focus().setImage({ src, alt: '' }).run()
}

export function insertYoutube(editor: Editor) {
  const src = ask('YouTube URL', 'https://www.youtube.com/watch?v=')
  if (src && !editor.chain().focus().setYoutubeVideo({ src }).run()) {
    window.alert('That doesn’t look like a YouTube link.')
  }
}

export function insertInlineMath(editor: Editor) {
  const latex = ask('Inline LaTeX', 'E = mc^2')
  if (latex) editor.chain().focus().insertInlineMath({ latex }).run()
}

export function insertBlockMath(editor: Editor) {
  const latex = ask('Block LaTeX', '\\int_0^1 x^2\\,dx = \\tfrac{1}{3}')
  if (latex) editor.chain().focus().insertBlockMath({ latex }).run()
}

const callout = (variant: CalloutVariant): BlockAction => ({
  id: `callout-${variant}`,
  label: `${CALLOUT_VARIANTS[variant].label} callout`,
  icon: CALLOUT_VARIANTS[variant].icon,
  hint: `:::${variant}`,
  keywords: 'callout note alert admonition',
  run: (editor) => editor.chain().focus().setCallout(variant).run(),
})

export const blockActions: BlockAction[] = [
  { id: 'paragraph', label: 'Text', icon: '¶', keywords: 'paragraph plain', run: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: 'Heading 1', icon: 'H1', hint: '#', keywords: 'title', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', icon: 'H2', hint: '##', keywords: 'subtitle', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', icon: 'H3', hint: '###', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'bullet', label: 'Bullet list', icon: '•', hint: '-', keywords: 'unordered ul', run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', icon: '1.', hint: '1.', keywords: 'ordered ol', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'task', label: 'Task list', icon: '☑', hint: '[ ]', keywords: 'todo checkbox', run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: 'Quote', icon: '❝', hint: '>', keywords: 'blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Code block', icon: '{ }', hint: '```', keywords: 'snippet syntax', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'divider', label: 'Divider', icon: '―', hint: '---', keywords: 'horizontal rule hr', run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    id: 'table',
    label: 'Table',
    icon: '▦',
    keywords: 'grid rows columns',
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'image', label: 'Image', icon: '🖼', keywords: 'picture photo', hint: 'or drop / paste', run: insertImage },
  { id: 'youtube', label: 'YouTube video', icon: '▶', keywords: 'embed video', run: insertYoutube },
  { id: 'details', label: 'Toggle section', icon: '▸', keywords: 'details collapsible accordion', run: (e) => e.chain().focus().setDetails().run() },
  callout('info'),
  callout('success'),
  callout('warning'),
  callout('danger'),
  { id: 'math-inline', label: 'Inline math', icon: '∑', hint: '$$x$$', keywords: 'latex katex formula equation', run: insertInlineMath },
  { id: 'math-block', label: 'Math block', icon: '∫', hint: '$$$x$$$', keywords: 'latex katex formula equation', run: insertBlockMath },
  { id: 'date', label: "Today's date", icon: '📅', hint: '!today', keywords: 'time now', run: (e) => e.chain().focus().insertDate().run() },
]

export function filterBlockActions(query: string): BlockAction[] {
  const q = query.toLowerCase().trim()
  if (!q) return blockActions
  return blockActions.filter((a) => `${a.label} ${a.keywords ?? ''} ${a.id}`.toLowerCase().includes(q))
}
