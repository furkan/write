import type { Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { PARAGRAPH_TYPES, type ParagraphFormat } from '../../editor/schema'

/** What Normal text and headings have without paragraph attributes (see App.css), in the units the attributes use. */
export const DEFAULT_LINE_HEIGHT = 1.08
const SPACE_BEFORE = [0, 12, 2, 2, 2, 2, 2]
const heading = (node: Node) => (node.type.name === 'heading' ? (node.attrs.level as number) : 0)

/** Space before a block (pt) when it has none of its own: Heading 1 has 12, other headings 2. */
export const defaultSpaceBefore = (node: Node) => SPACE_BEFORE[heading(node)] ?? 2
/** Space after: 8 under Normal text, none under a heading. */
export const defaultSpaceAfter = (node: Node) => (heading(node) ? 0 : 8)

export const LINE_SPACINGS = [1, 1.08, 1.15, 1.5, 2, 2.5, 3]

/** The "Add space" amount, like Word's 12 pt. */
export const ADDED_SPACE = 12

/** The selection's paragraphs and headings. */
export function selectedParagraphs(state: EditorState): Node[] {
  const { from, to } = state.selection
  const nodes: Node[] = []
  state.doc.nodesBetween(from, to, (node) => {
    if (!PARAGRAPH_TYPES.includes(node.type.name)) return true
    nodes.push(node)
    return false
  })
  return nodes
}

/** The paragraph or heading the cursor is in (the selection's start), if it is in one. */
export function cursorParagraph(state: EditorState): Node | null {
  const { $from } = state.selection
  return PARAGRAPH_TYPES.includes($from.parent.type.name) ? $from.parent : null
}

export type ParagraphSummary = {
  /** Effective values; `null` when the selected paragraphs differ. */
  lineHeight: number | null
  spaceBefore: number | null
  spaceAfter: number | null
}

const same = (values: number[]) => (values.every((v) => v === values[0]) ? values[0] : null)

/** The effective line spacing and space before/after of the selection (own attribute, else the style's). */
export function summarizeParagraphs(state: EditorState): ParagraphSummary {
  const nodes = selectedParagraphs(state)
  const read = (attr: keyof ParagraphFormat, fallback: (node: Node) => number) =>
    same(nodes.map((n) => (n.attrs[attr] as number | null) ?? fallback(n)))
  if (!nodes.length) return { lineHeight: null, spaceBefore: null, spaceAfter: null }
  return {
    lineHeight: read('lineHeight', () => DEFAULT_LINE_HEIGHT),
    spaceBefore: read('spaceBefore', defaultSpaceBefore),
    spaceAfter: read('spaceAfter', defaultSpaceAfter),
  }
}
