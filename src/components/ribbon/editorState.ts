import type { Editor } from '@tiptap/react'
import type { Session } from '../../editor/collab'
import { selectionFontSize } from './fontSize'

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const
export type HeadingLevel = (typeof HEADING_LEVELS)[number]

export const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const

/** What the ribbon shows for the current selection: a single `useEditorState` selector. */
export const selectRibbonState = (e: Editor) => {
  const textStyle = e.getAttributes('textStyle')
  return {
    bold: e.isActive('bold'),
    italic: e.isActive('italic'),
    underline: e.isActive('underline'),
    strike: e.isActive('strike'),
    code: e.isActive('code'),
    subscript: e.isActive('subscript'),
    superscript: e.isActive('superscript'),
    spoiler: e.isActive('spoiler'),
    link: e.isActive('link'),
    heading: HEADING_LEVELS.find((level) => e.isActive('heading', { level })) ?? 0,
    fontFamily: (textStyle.fontFamily as string | undefined) ?? '',
    /** In rendered px; `null` for a selection that mixes sizes. */
    fontSize: selectionFontSize(e.state),
    align: ALIGNMENTS.find((a) => e.isActive({ textAlign: a })) ?? 'left',
    bulletList: e.isActive('bulletList'),
    orderedList: e.isActive('orderedList'),
    taskList: e.isActive('taskList'),
    blockquote: e.isActive('blockquote'),
    codeBlock: e.isActive('codeBlock'),
    codeLanguage: (e.getAttributes('codeBlock').language as string | undefined) ?? 'plaintext',
    table: e.isActive('table'),
    canMerge: e.isActive('table') && e.can().mergeCells(),
    canSplit: e.isActive('table') && e.can().splitCell(),
    canUndo: e.can().undo(),
    canRedo: e.can().redo(),
    // The innermost list item type, so nested bullet-in-task lists indent the right thing.
    listItemType: (() => {
      const { $from } = e.state.selection
      for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name
        if (name === 'listItem' || name === 'taskItem') return name
      }
      return null
    })(),
  }
}

export type RibbonState = ReturnType<typeof selectRibbonState>

/** Props every tab gets. `session` is the shared document, for settings kept in it (page setup). */
export type TabProps = { editor: Editor; session: Session; s: RibbonState; disabled: boolean }

/** Keeps the editor's selection: ribbon controls never take focus on mousedown. */
export const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault()

export const tooltip = (label: string, shortcut?: string) => (shortcut ? `${label} (${shortcut})` : label)
