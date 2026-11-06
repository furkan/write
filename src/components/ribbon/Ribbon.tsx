import { useEditorState, type Editor } from '@tiptap/react'
import { ChevronDown, ChevronUp, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { Session } from '../../editor/collab'
import { mod } from '../../editor/platform'
import { CodeTab, TableTab } from './ContextualTabs'
import { FileTab } from './FileTab'
import { RibbonButton } from './controls'
import { keepSelection, selectRibbonState, type TabProps } from './editorState'
import { HomeTab } from './HomeTab'
import { InsertTab } from './InsertTab'
import { LayoutTab } from './LayoutTab'
import { ViewTab } from './ViewTab'
import { clickTab, closeFlyout, focusTab, setCollapsed, useRibbonView, type RibbonTab } from './state'
import './ribbon.css'

type TabDef = {
  id: RibbonTab
  label: string
  contextual?: boolean
  /** File and View work in read-only too (export, print, view options); they disable what they must. */
  readOnlyToo?: boolean
  Panel: (props: TabProps) => ReactNode
}

const tabId = (id: RibbonTab) => `ribbon-tab-${id}`
const PANEL_ID = 'ribbon-panel'

type RibbonProps = {
  editor: Editor
  session: Session
  readOnly: boolean
  /** The bar's start (logo and title) and end (who's here, Share, theme, account, tours). */
  start: ReactNode
  end: ReactNode
}

/**
 * Word-style ribbon, the page's whole top bar: the title, quick access, the tab row, the page's
 * actions, and the selected tab's groups.
 */
export function Ribbon({ editor, session, readOnly, start, end }: RibbonProps) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => selectRibbonState(e) })
  const view = useRibbonView()
  const rootRef = useRef<HTMLDivElement>(null)

  // Like Word, contextual tabs appear while the cursor is in a table or code block, but the ribbon
  // doesn't switch to them. They have nothing to offer a reader.
  const tabs: TabDef[] = [
    { id: 'file', label: 'File', readOnlyToo: true, Panel: FileTab },
    { id: 'home', label: 'Home', Panel: HomeTab },
    { id: 'insert', label: 'Insert', Panel: InsertTab },
    // Shown to everyone, like Word's; viewers and read-only get it disabled.
    { id: 'layout', label: 'Layout', Panel: LayoutTab },
    { id: 'view', label: 'View', readOnlyToo: true, Panel: ViewTab },
    ...(!readOnly && s.table ? [{ id: 'table' as const, label: 'Table', contextual: true, Panel: TableTab }] : []),
    ...(!readOnly && s.codeBlock ? [{ id: 'code' as const, label: 'Code', contextual: true, Panel: CodeTab }] : []),
  ]
  const current = tabs.find((t) => t.id === view.tab) ?? tabs[1]
  const disabled = readOnly && !current.readOnlyToo
  const showPanel = !view.collapsed || view.flyout

  // A contextual tab that went away hands back to Home for good, so coming back into a table
  // later doesn't select the Table tab again.
  useEffect(() => {
    if (current.id !== view.tab) focusTab('home')
  }, [current.id, view.tab])

  // Tabs that don't fit scroll sideways: keep the selected one in view (a tour may select one).
  useEffect(() => {
    const tab = document.getElementById(tabId(current.id))
    const row = tab?.parentElement
    if (!tab || !row) return
    const t = tab.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (t.left < r.left) row.scrollLeft -= r.left - t.left
    else if (t.right > r.right) row.scrollLeft += t.right - r.right
  }, [current.id])

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

  // Roving tabindex: the toolbar is one Tab stop (its last-focused control, else the first), and
  // the arrows move between controls across groups. Done on the DOM since the controls are many
  // small components; menus and pickers (inside `.dropdown-menu`) manage their own focus.
  const toolbarRef = useRef<HTMLDivElement>(null)
  const stop = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const bar = toolbarRef.current
    if (!bar) return
    const items = () => [...bar.querySelectorAll<HTMLElement>('button, input, select')].filter((el) => !el.closest('.dropdown-menu') && !el.matches(':disabled'))
    const sync = () => {
      const all = items()
      if (!stop.current || !all.includes(stop.current)) stop.current = all[0] ?? null
      for (const el of all) el.tabIndex = el === stop.current ? 0 : -1
    }
    const onFocus = (event: FocusEvent) => {
      const el = event.target as HTMLElement
      if (items().includes(el)) {
        stop.current = el
        sync()
      }
    }
    sync()
    // Controls come and go (a tab's contents, enabled state, a menu opening).
    const observer = new MutationObserver(sync)
    observer.observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] })
    bar.addEventListener('focusin', onFocus)
    return () => {
      observer.disconnect()
      bar.removeEventListener('focusin', onFocus)
    }
  }, [current.id, showPanel])

  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    // Typing, and the arrows inside a text field or a menu, are theirs.
    if (target.tagName !== 'BUTTON' || target.closest('.dropdown-menu') || event.altKey || event.ctrlKey || event.metaKey) return
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select')].filter(
      (el) => !el.closest('.dropdown-menu') && !el.matches(':disabled'),
    )
    const i = items.indexOf(target)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[event.key]
    if (next === undefined || i < 0) return
    event.preventDefault()
    items[Math.max(0, Math.min(items.length - 1, next))].focus()
  }

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
        {start}
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
                data-tour={`${t.id}-tab`}
                onMouseDown={keepSelection}
                onClick={() => clickTab(t.id)}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        {end}
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
            ref={toolbarRef}
            className="ribbon-groups"
            role="toolbar"
            aria-label={current.label}
            aria-disabled={disabled}
            onKeyDown={onToolbarKey}
          >
            <current.Panel editor={editor} session={session} s={s} disabled={disabled} />
          </div>
        </div>
      )}
    </div>
  )
}
