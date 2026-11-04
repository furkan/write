import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { CALLOUT_VARIANTS, isVariant, variantList, type CalloutVariant } from './callout-variants'

/** React node view for the Callout node: the icon cycles through the variants. */
export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant: CalloutVariant = isVariant(node.attrs.variant) ? node.attrs.variant : 'info'
  const next = variantList[(variantList.indexOf(variant) + 1) % variantList.length]
  const meta = CALLOUT_VARIANTS[variant]

  return (
    <NodeViewWrapper className="callout" data-variant={variant}>
      <button
        type="button"
        className="callout-icon"
        contentEditable={false}
        disabled={!editor.isEditable}
        title={`${meta.label} — click for ${CALLOUT_VARIANTS[next].label}`}
        aria-label={`Callout type: ${meta.label}. Click to change.`}
        onClick={() => updateAttributes({ variant: next })}
      >
        {meta.icon}
      </button>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  )
}
