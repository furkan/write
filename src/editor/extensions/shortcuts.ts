import { Extension, InputRule, textInputRule, type Editor } from '@tiptap/core'
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
