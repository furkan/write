import type { Node as PMNode } from '@tiptap/pm/model'
import { TableMap } from '@tiptap/pm/tables'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration } from '@tiptap/pm/view'

/*
 * Tables in Print layout. Each row is its own box (a CSS grid), so rows move to the next page one
 * at a time; one table-sized box would move whole, or never fit. Rows that are separate grids
 * don't know about each other, so every cell is placed in its column explicitly, from the
 * table's map: a cell below a `rowspan` keeps its own column instead of sliding left, and any
 * `colspan` spans the right columns. The table gets the column template (resized columns keep
 * their width), and its rows inherit it.
 */

const isTable = (node: PMNode) => node.type.spec.tableRole === 'table'

/** Column placement for every cell of every table, and each table's column template. */
export function tableDecorations(doc: PMNode): Decoration[] {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!isTable(node)) return !node.isTextblock
    const map = TableMap.get(node)
    const widths: (number | null)[] = Array.from({ length: map.width }, () => null)
    const start = pos + 1
    for (const cellPos of new Set(map.map)) {
      const cell = node.nodeAt(cellPos)
      if (!cell) continue
      const { left, right } = map.findCell(cellPos)
      const colwidth = cell.attrs.colwidth as (number | null)[] | null
      colwidth?.forEach((width, i) => {
        if (width && widths[left + i] === null) widths[left + i] = width
      })
      decorations.push(
        Decoration.node(start + cellPos, start + cellPos + cell.nodeSize, { style: `grid-column: ${left + 1} / ${right + 1}` }, { table: true }),
      )
    }
    const columns = widths.map((width) => (width ? `${width}px` : 'minmax(0, 1fr)')).join(' ')
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { style: `--table-columns: ${columns}` }, { table: true }))
    return false
  })
  return decorations
}

/** Whether a transaction changed anything inside a table (or a whole table), in the new document. */
export function touchesTable(tr: Transaction): boolean {
  const { doc } = tr
  let touched = false
  tr.mapping.maps.forEach((stepMap, index) => {
    const rest = tr.mapping.slice(index + 1)
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      if (touched) return
      const from = Math.min(rest.map(newFrom, -1), doc.content.size)
      const to = Math.min(rest.map(newTo, 1), doc.content.size)
      const $from = doc.resolve(from)
      for (let depth = $from.depth; depth > 0 && !touched; depth--) touched = isTable($from.node(depth))
      doc.nodesBetween(from, to, (node) => {
        if (touched || isTable(node)) touched = true
        return !touched && !node.isTextblock
      })
    })
  })
  return touched
}
