import { mergeAttributes, Node, wrappingInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CALLOUT_VARIANTS, isVariant, type CalloutVariant } from './callout-variants'
import { CalloutView } from './CalloutView'

/**
 * A custom node rendered with a React node view: a coloured callout box whose
 * variant is switched by clicking its icon. Type `:::info `, `:::warning `,
 * `:::success ` or `:::danger ` at the start of a line to create one.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType
      toggleCallout: (variant?: CalloutVariant) => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (element) => {
          const value = element.getAttribute('data-variant')
          return isVariant(value) ? value : 'info'
        },
        renderHTML: (attributes) => ({ 'data-variant': attributes.variant }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0]
  },

  // Serialises to a GitHub-style alert: `> [!NOTE]`.
  renderMarkdown: (node, h) => {
    const variant = isVariant(node.attrs?.variant) ? node.attrs.variant : 'info'
    const body = h.renderChildren(node.content ?? [], '\n\n')
    const quoted = body
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')
    return `> [!${CALLOUT_VARIANTS[variant].alert}]\n${quoted}`
  },

  // Parses GitHub-style alerts (`> [!NOTE]` …) back into callouts.
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => src.search(/^> \[!(?:NOTE|TIP|WARNING|CAUTION)\]/m),
    tokenize(src, _tokens, lexer) {
      const match = /^> \[!(NOTE|TIP|WARNING|CAUTION)\][^\n]*\n((?:>[^\n]*(?:\n|$))*)/.exec(src)
      if (!match) return undefined
      const body = match[2].replace(/^> ?/gm, '').trimEnd()
      return { type: 'callout', raw: match[0], alert: match[1], tokens: lexer.blockTokens(body) }
    },
  },

  parseMarkdown: (token, h) => {
    const variant =
      (Object.keys(CALLOUT_VARIANTS) as CalloutVariant[]).find((v) => CALLOUT_VARIANTS[v].alert === token.alert) ?? 'info'
    const content = h.parseChildren(token.tokens ?? [])
    return h.createNode('callout', { variant }, content.length ? content : [{ type: 'paragraph' }])
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addCommands() {
    return {
      setCallout:
        (variant = 'info') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
      toggleCallout:
        (variant = 'info') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { variant }),
    }
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^:::(info|success|warning|danger)?\s$/,
        type: this.type,
        getAttributes: (match) => ({ variant: match[1] ?? 'info' }),
      }),
    ]
  },
})
