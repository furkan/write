import type { TableOfContentData } from '@tiptap/extension-table-of-contents'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'

export type EditorEvent = { id: number; type: string; detail: string; at: number }

type SidebarProps = {
  editor: Editor
  toc: TableOfContentData
  events: EditorEvent[]
  onClearEvents: () => void
}

export function Sidebar({ editor, toc, events, onClearEvents }: SidebarProps) {
  return (
    <aside className="sidebar">
      <TableOfContents editor={editor} toc={toc} />
      <Inspector editor={editor} events={events} onClearEvents={onClearEvents} />
    </aside>
  )
}

function TableOfContents({ editor, toc }: { editor: Editor; toc: TableOfContentData }) {
  const jump = (pos: number, dom: HTMLElement) => {
    const { tr } = editor.state
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
    editor.view.dispatch(tr)
    editor.view.focus()
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

const TABS = ['JSON', 'HTML', 'Markdown', 'Text', 'Events'] as const
type Tab = (typeof TABS)[number]

function Inspector({ editor, events, onClearEvents }: { editor: Editor; events: EditorEvent[]; onClearEvents: () => void }) {
  const [tab, setTab] = useState<Tab>('JSON')
  const [open, setOpen] = useState(true)

  // Serialising the whole document is expensive, so re-run it only for content changes
  // (not selection or cursor moves), debounced, and only while the panel shows it.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!open || tab === 'Events') return
    let timer: number | undefined
    const onUpdate = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setVersion((v) => v + 1), 250)
    }
    editor.on('update', onUpdate)
    return () => {
      window.clearTimeout(timer)
      editor.off('update', onUpdate)
    }
  }, [editor, open, tab])

  const output = useMemo(() => {
    if (!open) return ''
    switch (tab) {
      case 'JSON':
        return JSON.stringify(editor.getJSON(), null, 2)
      case 'HTML':
        return editor.getHTML().replace(/></g, '>\n<')
      case 'Markdown':
        return editor.getMarkdown()
      case 'Text':
        return editor.getText({ blockSeparator: '\n\n' })
      case 'Events':
        return ''
    }
    // `version` changes after document edits; it is the recompute trigger.
  }, [editor, open, tab, version]) // oxlint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    const text = tab === 'Events' ? JSON.stringify(events, null, 2) : output
    navigator.clipboard?.writeText(text).catch(() => undefined)
  }

  return (
    <section className="panel inspector" data-tour="inspector" aria-labelledby="inspector-title">
      <div className="panel-header">
        <h2 id="inspector-title" className="panel-title">
          Inspector
        </h2>
        <button type="button" className="link-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <>
          <div className="tabs" role="tablist" aria-label="Output format">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'active' : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Events' ? (
            <div className="events" role="log" aria-live="off">
              <div className="events-actions">
                <span className="muted small">Latest editor events</span>
                <button type="button" className="link-button" onClick={onClearEvents}>
                  Clear
                </button>
              </div>
              {events.length === 0 ? (
                <p className="muted small">Type or move the cursor…</p>
              ) : (
                <ul>
                  {events.map((event) => (
                    <li key={event.id}>
                      <code className={`event-type event-${event.type}`}>{event.type}</code>
                      <span className="event-detail">{event.detail}</span>
                      <time className="muted">{new Date(event.at).toLocaleTimeString()}</time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <pre className="output" tabIndex={0} aria-label={`${tab} output`}>
              {output}
            </pre>
          )}
          <div className="panel-footer">
            <code className="muted small">
              {tab === 'JSON' && 'editor.getJSON()'}
              {tab === 'HTML' && 'editor.getHTML()'}
              {tab === 'Markdown' && 'editor.getMarkdown()'}
              {tab === 'Text' && 'editor.getText()'}
              {tab === 'Events' && "editor.on('update' | 'selectionUpdate' | …)"}
            </code>
            <button type="button" className="link-button" onClick={copy}>
              Copy
            </button>
          </div>
        </>
      )}
    </section>
  )
}
