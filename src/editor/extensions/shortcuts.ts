import { Extension, InputRule, textInputRule } from '@tiptap/core'
import { saveBackup } from '../backup'
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

export const Shortcuts = Extension.create({
  name: 'shortcuts',

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
      // Save a local backup instead of opening the browser's "Save page" dialog.
      'Mod-s': () => {
        saveBackup(this.editor)
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
