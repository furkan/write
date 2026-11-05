import { useEditorState, type Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { mod } from '../../editor/platform'
import { CodeTab, TableTab } from './ContextualTabs'
import { RibbonButton } from './controls'
import { keepSelection, selectRibbonState, type TabProps } from './editorState'
import { HomeTab } from './HomeTab'
import { InsertTab } from './InsertTab'
import { clickTab, closeFlyout, focusTab, setCollapsed, useRibbonView, type RibbonTab } from './state'
import './ribbon.css'

type TabDef = { id: RibbonTab; label: string; contextual?: boolean; Panel: (props: TabProps) => ReactNode }

const tabId = (id: RibbonTab) => `ribbon-tab-${id}`
const PANEL_ID = 'ribbon-panel'

/** Word-style ribbon: quick access, a tab row, and the selected tab's groups. */
export function Ribbon({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => selectRibbonState(e) })
  const view = useRibbonView()
  const rootRef = useRef<HTMLDivElement>(null)

  // Like Word, contextual tabs appear while the cursor is in a table or code block, but the ribbon
  // doesn't switch to them. They have nothing to offer a reader.
  const tabs: TabDef[] = [
    { id: 'home', label: 'Home', Panel: HomeTab },
    { id: 'insert', label: 'Insert', Panel: InsertTab },
    ...(!readOnly && s.table ? [{ id: 'table' as const, label: 'Table', contextual: true, Panel: TableTab }] : []),
    ...(!readOnly && s.codeBlock ? [{ id: 'code' as const, label: 'Code', contextual: true, Panel: CodeTab }] : []),
  ]
  const current = tabs.find((t) => t.id === view.tab) ?? tabs[0]
  const showPanel = !view.collapsed || view.flyout

  // A contextual tab that went away hands back to Home for good, so coming back into a table
  // later doesn't select the Table tab again.
  useEffect(() => {
    if (current.id !== view.tab) focusTab('home')
  }, [current.id, view.tab])

  useStickyOffset(rootRef)

  // The collapsed ribbon's flyout closes on a click elsewhere (but not on a tour's own popover),
  // and on Escape, which an open menu inside it takes first (Dropdown stops it in the capture
  // phase). From the keyboard,
  // focus goes back to the selected tab.
  useEffect(() => {
    if (!view.flyout) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element
      if (!rootRef.current?.contains(target) && !target.closest?.('.driver-popover, .driver-overlay')) closeFlyout()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (rootRef.current?.contains(document.activeElement)) rootRef.current.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
      closeFlyout()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [view.flyout])

  const onTabKey = (event: KeyboardEvent) => {
    const index = tabs.indexOf(current)
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[(next + tabs.length) % tabs.length]
    focusTab(tab.id)
    document.getElementById(tabId(tab.id))?.focus()
  }

  const chain = () => editor.chain().focus()

  return (
    <div
      ref={rootRef}
      className={`ribbon${view.collapsed ? ' collapsed' : ''}`}
      data-tour="toolbar"
      onBlur={(event) => {
        // Tabbing out of the flyout closes it, rather than leaving it over the document.
        const next = event.relatedTarget as Element | null
        if (view.flyout && next && !rootRef.current?.contains(next) && !next.closest('.driver-popover')) closeFlyout()
      }}
    >
      <div className="ribbon-bar">
        <div className="ribbon-qat" role="group" aria-label="Quick access" data-tour="history">
          <RibbonButton label="Undo" shortcut={`${mod}+Z`} icon={Undo2} disabled={readOnly || !s.canUndo} onClick={() => chain().undo().run()} />
          <RibbonButton
            label="Redo"
            shortcut={`${mod}+Shift+Z`}
            icon={Redo2}
            disabled={readOnly || !s.canRedo}
            onClick={() => chain().redo().run()}
          />
        </div>
        <div className="ribbon-tabs" role="tablist" aria-label="Ribbon" onKeyDown={onTabKey}>
          {tabs.map((t) => {
            const selected = t.id === current.id
            return (
              <button
                key={t.id}
                id={tabId(t.id)}
                type="button"
                role="tab"
                className={`ribbon-tab${t.contextual ? ' contextual' : ''}`}
                aria-selected={selected}
                aria-controls={selected && showPanel ? PANEL_ID : undefined}
                tabIndex={selected ? 0 : -1}
                data-tour={t.id === 'insert' ? 'insert' : undefined}
                onMouseDown={keepSelection}
                onClick={() => clickTab(t.id)}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="ribbon-btn small ribbon-pin"
          title={view.collapsed ? 'Always show the ribbon' : 'Collapse the ribbon'}
          aria-label={view.collapsed ? 'Always show the ribbon' : 'Collapse the ribbon'}
          aria-expanded={!view.collapsed}
          onMouseDown={keepSelection}
          onClick={() => setCollapsed(!view.collapsed)}
        >
          {view.collapsed ? <ChevronDown aria-hidden size={16} /> : <ChevronUp aria-hidden size={16} />}
        </button>
      </div>
      {showPanel && (
        <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(current.id)} className={`ribbon-panel${view.collapsed ? ' flyout' : ''}`}>
          <div
            className="ribbon-groups"
            role="toolbar"
            aria-label={current.label}
            aria-disabled={readOnly}
          >
            <current.Panel editor={editor} s={s} disabled={readOnly} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Publishes the ribbon's height as `--ribbon-height`, so the sticky sidebar and headings clear it. */
function useStickyOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => root.style.setProperty('--ribbon-height', `${element.offsetHeight}px`))
    observer.observe(element)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--ribbon-height')
    }
  }, [ref])
}
