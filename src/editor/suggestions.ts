import { gitHubEmojis, type EmojiItem } from '@tiptap/extension-emoji'
import type { SuggestionOptions } from '@tiptap/suggestion'
import { renderSuggestionList } from './suggestion/render'
import type { SuggestionItem } from './suggestion/SuggestionList'

export const PEOPLE = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Katherine Johnson',
  'Linus Torvalds',
  'Margaret Hamilton',
  'Tim Berners-Lee',
  'Barbara Liskov',
  'Donald Knuth',
  'Radia Perlman',
]

export const mentionSuggestion: Omit<SuggestionOptions<SuggestionItem>, 'editor'> = {
  char: '@',
  items: ({ query }) =>
    PEOPLE.filter((name) => name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8)
      // Only `id` and `label` — the default Mention command stores the item as node attrs.
      .map((name) => ({ id: name.toLowerCase().replace(/\s+/g, '-'), label: name })),
  render: renderSuggestionList('No people found'),
}

const emojiMatches = (emoji: EmojiItem, query: string) =>
  emoji.shortcodes.some((code) => code.startsWith(query)) || emoji.tags.some((tag) => tag.startsWith(query))

export const emojiSuggestion: Omit<SuggestionOptions<SuggestionItem>, 'editor'> = {
  items: ({ query }) => {
    const q = query.toLowerCase()
    return gitHubEmojis
      .filter((emoji) => emoji.emoji && emojiMatches(emoji, q))
      .slice(0, 8)
      .map((emoji) => ({ id: emoji.name, name: emoji.name, label: `:${emoji.shortcodes[0]}:`, icon: emoji.emoji }))
  },
  // Store just the emoji name; the list item carries display-only fields.
  command: ({ editor, range, props }) => {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'emoji', attrs: { name: props.name } },
        { type: 'text', text: ' ' },
      ])
      .run()
  },
  render: renderSuggestionList('No emoji found'),
}
