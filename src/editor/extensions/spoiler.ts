import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'

/**
 * A custom mark: text hidden behind a blur until hovered.
 * Shows off input rules (`||text||` while typing), paste rules (`||text||` in
 * pasted text), a keyboard shortcut, commands, and Markdown round-tripping.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    spoiler: {
      toggleSpoiler: () => ReturnType
    }
  }
}

export const spoilerInputRegex = /(?:^|\s)(\|\|(?!\s+\|\|)((?:[^|]+))\|\|(?!\s+\|\|))$/
export const spoilerPasteRegex = /(?:^|\s)(\|\|(?!\s+\|\|)((?:[^|]+))\|\|(?!\s+\|\|))/g

export const Spoiler = Mark.create({
  name: 'spoiler',

  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'spoiler' }), 0]
  },

  renderMarkdown: (node, h) => `||${h.renderChildren(node)}||`,

  parseMarkdown: (token, h) => h.applyMark('spoiler', h.parseInline(token.tokens || [])),

  markdownTokenizer: {
    name: 'spoiler',
    level: 'inline',
    start: (src: string) => src.indexOf('||'),
    tokenize(src, _tokens, h) {
      const match = /^\|\|(?!\s)([^|]*[^|\s])\|\|/.exec(src)
      if (!match) return undefined
      return { type: 'spoiler', raw: match[0], text: match[1], tokens: h.inlineTokens(match[1]) }
    },
  },

  addCommands() {
    return {
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-s': () => this.editor.commands.toggleSpoiler(),
    }
  },

  addInputRules() {
    return [markInputRule({ find: spoilerInputRegex, type: this.type })]
  },

  addPasteRules() {
    return [markPasteRule({ find: spoilerPasteRegex, type: this.type })]
  },
})
