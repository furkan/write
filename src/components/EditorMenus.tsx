import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus'
import { blockActions, setLink } from '../editor/blocks'
import { ToolButton } from './ToolButton'
import { mod } from '../editor/platform'

const QUICK_BLOCKS = ['h1', 'h2', 'bullet', 'task', 'quote', 'code', 'table', 'image', 'callout-info', 'math-block']

/** Bubble menu (on text selection), floating "+" menu (on empty lines) and the block drag handle. */
export function EditorMenus({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      spoiler: e.isActive('spoiler'),
      link: e.isActive('link'),
      editable: e.isEditable,
    }),
  })

  const chain = () => editor.chain().focus()

  return (
    <>
      <BubbleMenu
        editor={editor}
        className="bubble-menu"
        options={{ placement: 'top', offset: 8 }}
        shouldShow={({ editor: e, state, view }) =>
          e.isEditable &&
          view.hasFocus() &&
          state.selection instanceof TextSelection &&
          !state.selection.empty &&
          !e.isActive('codeBlock')
        }
      >
        <ToolButton title="Bold" shortcut={`${mod}+B`} active={s.bold} onClick={() => chain().toggleBold().run()}>
          <b>B</b>
        </ToolButton>
        <ToolButton title="Italic" shortcut={`${mod}+I`} active={s.italic} onClick={() => chain().toggleItalic().run()}>
          <i>I</i>
        </ToolButton>
        <ToolButton title="Underline" shortcut={`${mod}+U`} active={s.underline} onClick={() => chain().toggleUnderline().run()}>
          <u>U</u>
        </ToolButton>
        <ToolButton title="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}>
          <s>S</s>
        </ToolButton>
        <ToolButton title="Inline code" active={s.code} onClick={() => chain().toggleCode().run()}>
          {'</>'}
        </ToolButton>
        <ToolButton
          title="Highlight"
          shortcut={`${mod}+Shift+H`}
          active={s.highlight}
          onClick={() => chain().toggleHighlight().run()}
        >
          <span className="swatch-label highlight on">H</span>
        </ToolButton>
        <ToolButton title="Spoiler" active={s.spoiler} onClick={() => chain().toggleSpoiler().run()}>
          ▒
        </ToolButton>
        <ToolButton title="Link" shortcut={`${mod}+K`} active={s.link} onClick={() => setLink(editor)}>
          🔗
        </ToolButton>
      </BubbleMenu>

      <FloatingMenu editor={editor} className="floating-menu" options={{ placement: 'bottom-start', offset: 4 }}>
        <span className="floating-plus" aria-hidden>
          ＋
        </span>
        {QUICK_BLOCKS.map((id) => {
          const action = blockActions.find((a) => a.id === id)
          if (!action) return null
          return (
            <ToolButton key={id} title={action.label} onClick={() => action.run(editor)}>
              {action.icon}
            </ToolButton>
          )
        })}
      </FloatingMenu>

      {s.editable && (
        <DragHandle editor={editor} className="drag-handle-wrapper">
          <div className="drag-handle" title="Drag to move · click to select" aria-label="Drag block">
            ⋮⋮
          </div>
        </DragHandle>
      )}
    </>
  )
}
