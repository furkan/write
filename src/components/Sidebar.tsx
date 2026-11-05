import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

export function Sidebar({ editor, toc }: { editor: Editor; toc: TableOfContentData }) {
  return (
    <aside className="sidebar">
      <TableOfContents editor={editor} toc={toc} />
    </aside>
  )
}

function TableOfContents({ editor, toc }: { editor: Editor; toc: TableOfContentData }) {
  const jump = (pos: number, fallback: HTMLElement) => {
    const { tr } = editor.state
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
    editor.view.dispatch(tr)
    editor.view.focus()
    // The element in the TOC data can be stale after re-renders; look up the live one.
    const live = editor.view.nodeDOM(pos)
    const target = live instanceof HTMLElement && live.isConnected ? live : fallback
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="panel" data-tour="toc" aria-labelledby="toc-title">
      <h2 id="toc-title" className="panel-title">
        Contents
      </h2>
      {toc.length === 0 ? (
        <p className="muted small">Add a heading to build the table of contents.</p>
      ) : (
        <ol className="toc">
          {toc.map((item) => (
            <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 12}px` }}>
              <button
                type="button"
                className={item.isActive ? 'active' : item.isScrolledOver ? 'passed' : undefined}
                onClick={() => jump(item.pos, item.dom)}
              >
                {item.textContent || <span className="muted">Untitled</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
