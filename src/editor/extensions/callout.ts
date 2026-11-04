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
