import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { TextSelection } from '@tiptap/pm/state'
import { useEditorState, type Editor } from '@tiptap/react'
import { X } from 'lucide-react'
import { navPanePref } from '../editor/view-prefs'

/**
 * Word's Navigation pane: the document's headings as a plain list down the left side, the one at
 * the cursor highlighted. Click one to go there. Toggled from the View tab, or closed here.
 */
export function NavigationPane({ editor, toc }: { editor: Editor; toc: TableOfContentData }) {
  const jump = (pos: number, fallback: HTMLElement) => {
    const { tr } = editor.state
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
    editor.view.dispatch(tr)
    editor.view.focus()
    // The element in the TOC data can be stale after re-renders; look up the live one.
    const live = editor.view.nodeDOM(pos)
    const target = live instanceof HTMLElement && live.isConnected ? live : fallback
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  // The heading the cursor is under: the last one at or before it.
  const cursor = useEditorState({ editor, selector: ({ editor: e }) => e.state.selection.from })
  const current = toc.findLast((item) => item.pos <= cursor)
  const minLevel = toc.reduce((min, item) => Math.min(min, item.level), 6)

  return (
    <nav className="nav-pane" data-tour="toc" aria-labelledby="nav-title">
      <div className="nav-pane-header">
        <h2 id="nav-title" className="nav-pane-title">
          Navigation
        </h2>
        <button type="button" className="nav-pane-close" aria-label="Close navigation pane" title="Close navigation pane" onClick={() => navPanePref.set(false)}>
          <X aria-hidden size={16} />
        </button>
      </div>
      {toc.length === 0 ? (
        <p className="nav-pane-empty">Headings you add show up here, so you can move around the document.</p>
      ) : (
        <ol className="toc">
          {toc.map((item) => (
            <li key={item.id} style={{ paddingLeft: `${(item.level - minLevel) * 14}px` }}>
              <button
                type="button"
                className={item === current ? 'active' : undefined}
                aria-current={item === current ? 'location' : undefined}
                onClick={() => jump(item.pos, item.dom)}
              >
                {item.textContent || <span className="muted">Untitled</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </nav>
  )
}
