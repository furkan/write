import type { Mark, Node } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/**
 * The size list's presets in points, also the steps Grow and Shrink take (Word's list). Sizes are
 * stored in pt; documents from before store px, which still render and show converted to pt.
 */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

const PX_PER_PT = 4 / 3

/** The size each block renders its text at without a font size of its own, in px (see App.css: 11pt; headings 16, 13, 12, 11, 11, 11pt). */
const HEADING_SIZE: Record<number, number> = {
  1: 16 * PX_PER_PT,
  2: 13 * PX_PER_PT,
  3: 12 * PX_PER_PT,
  4: 11 * PX_PER_PT,
  5: 11 * PX_PER_PT,
  6: 11 * PX_PER_PT,
}
/** The page's text size (Normal, 11pt), and the browser's root size (what pasted `rem` is relative to). */
const BODY_SIZE = 11 * PX_PER_PT
const ROOT_SIZE = 16
const blockSize = (block: Node) => (block.type.name === 'heading' ? (HEADING_SIZE[block.attrs.level as number] ?? BODY_SIZE) : BODY_SIZE)

const KEYWORDS: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  small: 13,
  medium: 16,
  large: 18,
  'x-large': 24,
  'xx-large': 32,
  'xxx-large': 48,
}

/**
 * A CSS `font-size` in rendered px. Pasted text keeps its own units (Google Docs uses pt), so
 * em, % and smaller/larger are relative to `base`, the block's size. `null` when unreadable.
 */
export function toPx(value: unknown, base: number): number | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v in KEYWORDS) return KEYWORDS[v]
  if (v === 'smaller') return base / 1.2
  if (v === 'larger') return base * 1.2
  const match = /^(\d*\.?\d+)(px|pt|em|rem|%)$/.exec(v)
  if (!match) return null
  const n = Number(match[1])
  const px = { px: n, pt: n * PX_PER_PT, em: n * base, rem: n * ROOT_SIZE, '%': (n * base) / 100 }[match[2]]
  return px !== undefined && Number.isFinite(px) && px > 0 ? px : null
}

/** A stretch of selected text at one size, with its text style (to keep its colour and font). */
type Run = { from: number; to: number; px: number; mark: Mark | undefined }

function sizeRuns(state: EditorState): Run[] {
  const { from, to, empty, $from } = state.selection
  const type = state.schema.marks.textStyle
  const runOf = (marks: readonly Mark[], block: Node, start: number, end: number): Run => {
    const mark = type.isInSet(marks)
    const base = blockSize(block)
    return { from: start, to: end, px: toPx(mark?.attrs.fontSize, base) ?? base, mark }
  }
  if (empty) return [runOf(state.storedMarks ?? $from.marks(), $from.parent, from, to)]
  const runs: Run[] = []
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isText && parent) runs.push(runOf(node.marks, parent, Math.max(from, pos), Math.min(to, pos + node.nodeSize)))
  })
  return runs
}

const round = (n: number) => Math.round(n * 10) / 10
const toPt = (px: number) => round(px / PX_PER_PT)

/** The selection's size in pt, or `null` when it mixes sizes (the box is then empty, like Word's). */
export function selectionFontSize(state: EditorState): number | null {
  const sizes = new Set(sizeRuns(state).map((run) => toPt(run.px)))
  return sizes.size === 1 ? [...sizes][0] : null
}

/** Grow (1) or Shrink (-1) to the next preset, each run of a mixed selection from its own size. */
export function stepFontSize(editor: Editor, direction: 1 | -1) {
  const next = (pt: number) =>
    direction > 0 ? (FONT_SIZES.find((n) => n > pt) ?? pt) : (FONT_SIZES.findLast((n) => n < pt) ?? pt)
  const runs = sizeRuns(editor.state)
  if (editor.state.selection.empty) {
    const pt = toPt(runs[0].px)
    const target = next(pt)
    if (target !== pt) editor.chain().focus().setFontSize(`${target}pt`).run()
    return
  }
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const type = tr.doc.type.schema.marks.textStyle
      for (const run of runs) {
        const pt = toPt(run.px)
        const target = next(pt)
        if (target !== pt) tr.addMark(run.from, run.to, type.create({ ...run.mark?.attrs, fontSize: `${target}pt` }))
      }
      return true
    })
    .run()
}

/** A size typed in the box: a plain number of pt from 1 to 400, else `null`. */
export function parseFontSize(text: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(text.trim())) return null
  const pt = Number(text)
  return pt >= 1 && pt <= 400 ? pt : null
}
