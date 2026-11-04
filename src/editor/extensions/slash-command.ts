import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { blockActions, filterBlockActions } from '../blocks'
import { renderSuggestionList } from '../suggestion/render'
import type { SuggestionItem } from '../suggestion/SuggestionList'

/** Type `/` to open a searchable menu of blocks, built on @tiptap/suggestion. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        // Don't trigger inside code blocks (e.g. typing a path or a comment).
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) =>
          filterBlockActions(query).map((a) => ({ id: a.id, label: a.label, icon: a.icon, hint: a.hint })),
        command: ({ editor, range, props }) => {
          const action = blockActions.find((a) => a.id === props.id)
          editor.chain().focus().deleteRange(range).run()
          action?.run(editor)
        },
        render: renderSuggestionList('No matching blocks'),
      }),
    ]
  },
})
