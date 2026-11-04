import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import './App.css'

const initialContent = `
<h1>Hello Tiptap 👋</h1>
<p>This is a <strong>rich-text</strong> editor built with <em>Tiptap</em> and React.</p>
<ul>
  <li>Use the toolbar, or</li>
  <li>try Markdown shortcuts like <code># </code>, <code>- </code>, <code>&gt; </code> and <code>**bold**</code>.</li>
</ul>
`

function Toolbar({ editor }: { editor: Editor }) {
  // Tiptap v3 doesn't re-render on every change, so subscribe to just what the toolbar needs.
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  })

  const btn = (label: string, title: string, active: boolean, run: () => void) => (
    <button
      type="button"
      title={title}
      className={active ? 'active' : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )

  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar">
      {btn('B', 'Bold', state.bold, () => chain().toggleBold().run())}
      {btn('I', 'Italic', state.italic, () => chain().toggleItalic().run())}
      {btn('S', 'Strikethrough', state.strike, () => chain().toggleStrike().run())}
      {btn('</>', 'Inline code', state.code, () => chain().toggleCode().run())}
      <span className="sep" />
      {btn('H1', 'Heading 1', state.h1, () => chain().toggleHeading({ level: 1 }).run())}
      {btn('H2', 'Heading 2', state.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn('H3', 'Heading 3', state.h3, () => chain().toggleHeading({ level: 3 }).run())}
      <span className="sep" />
      {btn('• List', 'Bullet list', state.bulletList, () => chain().toggleBulletList().run())}
      {btn('1. List', 'Numbered list', state.orderedList, () => chain().toggleOrderedList().run())}
      {btn('❝', 'Quote', state.blockquote, () => chain().toggleBlockquote().run())}
      {btn('{ }', 'Code block', state.codeBlock, () => chain().toggleCodeBlock().run())}
      <span className="sep" />
      <button type="button" title="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
        ↶
      </button>
      <button type="button" title="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
        ↷
      </button>
    </div>
  )
}

export default function App() {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    immediatelyRender: true,
  })

  return (
    <main className="app">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor" />
    </main>
  )
}
