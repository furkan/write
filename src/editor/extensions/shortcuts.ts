import { Extension, InputRule, textInputRule, type Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { setLink } from '../blocks'

/**
 * A custom extension with no schema of its own: commands, keyboard shortcuts
 * and input rules layered on top of the editor.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    shortcuts: {
      insertDate: () => ReturnType
    }
  }
}

/**
 * Moves the top-level block(s) the selection touches one place up or down, as a single plain
 * transaction (so it syncs like any edit). The keyboard path for what the drag handle does.
 */
function moveBlocks(editor: Editor, dir: -1 | 1) {
  if (!editor.isEditable) return false
  const { state, view } = editor
  const { doc, selection } = state
  // `to - 1` so a selection ending at the start of the next block doesn't drag that block along.
  const first = doc.resolve(selection.from).index(0)
  const last = doc.resolve(Math.max(selection.from, selection.to - 1)).index(0)
  const sibling = dir < 0 ? first - 1 : last + 1
  if (sibling < 0 || sibling >= doc.childCount) return true
  let start = 0
  for (let i = 0; i < first; i++) start += doc.child(i).nodeSize
  let end = start
  for (let i = first; i <= last; i++) end += doc.child(i).nodeSize
  const moved = doc.slice(start, end).content
  const size = doc.child(sibling).nodeSize
  const shift = dir < 0 ? -size : size
  const tr = state.tr.delete(start, end).insert(start + shift, moved)
  const from = selection.from + shift
  const to = selection.to + shift
  tr.setSelection(selection instanceof NodeSelection ? NodeSelection.create(tr.doc, from) : TextSelection.create(tr.doc, from, to))
  view.dispatch(tr.scrollIntoView())
  return true
}

const today = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

type ShortcutsOptions = {
  /** Called for Mod-S (instead of the browser's "Save page" dialog). */
  onSave: (editor: Editor) => void
}

export const Shortcuts = Extension.create<ShortcutsOptions>({
  name: 'shortcuts',

  addOptions() {
    return { onSave: () => undefined }
  },

  addCommands() {
    return {
      insertDate:
        () =>
        ({ commands }) =>
          commands.insertContent(today()),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-d': () => this.editor.commands.insertDate(),
      'Alt-Shift-ArrowUp': () => moveBlocks(this.editor, -1),
      'Alt-Shift-ArrowDown': () => moveBlocks(this.editor, 1),
      'Mod-k': () => {
        if (this.editor.isEditable) setLink(this.editor)
        return true
      },
      'Mod-s': () => {
        this.options.onSave(this.editor)
        return true
      },
    }
  },

  addInputRules() {
    return [
      // `!today ` → today's date (computed when the rule fires, not at load time).
      new InputRule({
        find: /!today\s$/,
        handler: ({ state, range }) => {
          state.tr.insertText(`${today()} `, range.from, range.to)
        },
      }),
      textInputRule({ find: /!shrug\s$/, replace: '¯\\_(ツ)_/¯ ' }),
      textInputRule({ find: /!check\s$/, replace: '✔ ' }),
    ]
  },
})
