import { NodeSelection } from '@tiptap/pm/state'
import { useEffect, useRef } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'

/** Alt text for the selected image: a labelled input, committed on every keystroke. */
function ImageAltField({ editor }: { editor: Editor }) {
  const alt = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.getAttributes('image').alt as string | null) ?? '',
  })
  const input = useRef<HTMLInputElement>(null)
  // Keyboard way in: with an image selected, Alt+Enter moves focus to the field (plain Enter keeps its normal behaviour).
  useEffect(() => {
    const dom = editor.view.dom
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return
      if (!editor.isEditable) return
      const { selection } = editor.state
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return
      event.preventDefault()
      input.current?.focus()
    }
    dom.addEventListener('keydown', onKey, true)
    return () => dom.removeEventListener('keydown', onKey, true)
  }, [editor])
  return (
    <label className="image-alt">
      <span>Alt text</span>
      <input
        ref={input}
        type="text"
        value={alt}
        placeholder="Describe the image"
        onChange={(e) => {
          editor.chain().updateAttributes('image', { alt: e.target.value }).run()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            editor.chain().focus().run()
          }
        }}
      />
    </label>
  )
}

/**
 * The one menu left on the page: alt text for a selected image. (Formatting lives in the ribbon,
 * like Word's, and blocks are moved with cut and paste or the keyboard; there is no selection
 * bubble, "+" menu or drag handle.) `scrollTarget`: what scrolls the document, so the menu follows it.
 */
export function EditorMenus({ editor, scrollTarget }: { editor: Editor; scrollTarget: HTMLElement | null }) {
  return (
    <BubbleMenu
      editor={editor}
      className="bubble-menu"
      options={{ placement: 'bottom', offset: 8, scrollTarget: scrollTarget ?? window }}
      shouldShow={({ editor: e, state }) =>
        e.isEditable && state.selection instanceof NodeSelection && state.selection.node.type.name === 'image'
      }
    >
      <ImageAltField editor={editor} />
    </BubbleMenu>
  )
}
