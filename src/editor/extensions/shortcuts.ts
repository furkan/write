import { Extension, InputRule, textInputRule, type Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
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
  // Same selection, shifted with the blocks: whatever kind it is (text, node, table cells).
  const json = selection.toJSON() as { type: string; anchor?: number; head?: number; pos?: number }
  if (json.type !== 'all') {
    if (json.anchor !== undefined) json.anchor += shift
    if (json.head !== undefined) json.head += shift
    if (json.pos !== undefined) json.pos += shift // GapCursor
    try {
      tr.setSelection(Selection.fromJSON(tr.doc, json))
    } catch {
      // Keep ProseMirror's own mapping of the selection.
    }
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * Tab types a tab character, as in Word, instead of the browser moving focus out of the
 * document (to the next button, or the address bar). Low priority, so lists (nest an item),
 * tables (next cell) and the suggestion menus handle Tab first. Shift+Tab deletes a tab right
 * before the cursor; otherwise it still moves focus back, so the keyboard can always leave.
 */
export const TabKey = Extension.create({
  name: 'tabKey',
  priority: 10,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { $from } = editor.state.selection
        if (!editor.isEditable || !$from.parent.isTextblock) return false
        // In a list item that can't be nested (the first one) Tab does nothing, rather than typing a tab.
        for (let d = $from.depth; d > 0; d--) if (['listItem', 'taskItem'].includes($from.node(d).type.name)) return true
        editor.view.dispatch(editor.state.tr.insertText('\t').scrollIntoView())
        return true
      },
      'Shift-Tab': ({ editor }) => {
        const { empty, $from } = editor.state.selection
        if (!editor.isEditable || !empty || $from.nodeBefore?.text?.endsWith('\t') !== true) return false
        editor.view.dispatch(editor.state.tr.delete($from.pos - 1, $from.pos))
        return true
      },
    }
  },
})

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
