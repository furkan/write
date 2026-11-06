import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UndoManager } from 'yjs'
import { createStore, useStore } from '../store'
import type { Session } from './collab'
import type { PaginationOptions } from './extensions/pagination/Pagination'
import { readStorage, writeStorage } from './storage'
import { IN, marginsOf, PAPER_SIZES, PAGE_SETUP_KEYS as KEYS, readPageSetup, serializeMargins, type PageSetup } from './paper'

/*
 * Page setup belongs to the document (like Word's Layout tab); its values are in paper.ts, which
 * the server's PDF export shares. How you look at the document (pages or one long page) is your
 * own preference.
 */

export {
  DEFAULT_PAGE_SETUP,
  marginsOf,
  MARGIN_PRESETS,
  MAX_MARGIN,
  ORIENTATIONS,
  PAPER_SIZES,
  type MarginPreset,
  type Orientation,
  type PageSetup,
  type PaperSize,
} from './paper'

/** Reads the page setup from the shared document; anything missing or unknown is the default. */
export const getPageSetup = (session: Session): PageSetup => readPageSetup(session.meta)

/**
 * Undo: a page setup change is one step in the editor's own undo history, like in Word, so
 * Ctrl+Z (or the ribbon's Undo) right after choosing Letter goes back to A4, not to your last
 * typing. The editor's Yjs undo manager tracks the `meta` map too (see `trackPageSetupUndo`), but
 * only changes made with this origin: renaming the document isn't undone by Ctrl+Z.
 */
export const PAGE_SETUP_ORIGIN = { pageSetup: true }

const undoManagers = new WeakMap<Session, UndoManager>()

/** Adds page setup changes to the editor's undo history (its Yjs undo manager). */
export function trackPageSetupUndo(session: Session, undoManager: UndoManager) {
  undoManager.trackedOrigins.add(PAGE_SETUP_ORIGIN)
  undoManager.addToScope(session.meta)
  undoManagers.set(session, undoManager)
}

/** Changes the page setup for everyone. The server drops a viewer's writes, so only offer it to editors. */
export function setPageSetup(session: Session, change: Partial<PageSetup>) {
  const undoManager = undoManagers.get(session)
  // Its own undo step: not merged with typing just before or just after it.
  undoManager?.stopCapturing()
  session.ydoc.transact(() => {
    for (const key of Object.keys(change) as (keyof PageSetup)[]) {
      const value = change[key]
      if (!value) continue
      session.meta.set(KEYS[key], key === 'customMargins' ? serializeMargins(value as NonNullable<PageSetup['customMargins']>) : value)
    }
  }, PAGE_SETUP_ORIGIN)
  undoManager?.stopCapturing()
}

/** The page setup, live across collaborators. */
export function usePageSetup(session: Session): PageSetup {
  const [setup, setSetup] = useState(() => getPageSetup(session))
  useEffect(() => {
    const update = () =>
      setSetup((prev) => {
        const next = getPageSetup(session)
        const same =
          prev.size === next.size &&
          prev.orientation === next.orientation &&
          prev.margins === next.margins &&
          serializeMargins(marginsOf(prev)) === serializeMargins(marginsOf(next))
        return same ? prev : next
      })
    update()
    session.meta.observe(update)
    return () => session.meta.unobserve(update)
  }, [session])
  return setup
}

/** Page width, height and margins in CSS pixels. */
export function pageGeometry(setup: PageSetup): Omit<PaginationOptions, 'enabled' | 'pageGap'> {
  const paper = PAPER_SIZES[setup.size]
  const landscape = setup.orientation === 'landscape'
  const [marginTop, marginRight, marginBottom, marginLeft] = marginsOf(setup)
  return {
    pageWidth: landscape ? paper.height : paper.width,
    pageHeight: landscape ? paper.width : paper.height,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
  }
}

/**
 * The `@page` rules for printing, in either layout: the browser splits the document into sheets
 * of the document's paper size, with its margins (Print layout's on-screen pages are never
 * printed: see pagination.css). Page numbers are a rule of their own, so a browser without
 * margin boxes (WebKit) drops only that rule and keeps the size and margins; Safari can add its
 * own numbers ("Print headers and footers"). `--print-content-height` is a sheet's printable
 * height, for images (layout.css).
 */
export function pageRules(setup: PageSetup): string {
  const [width, height] = PAPER_SIZES[setup.size].css
  const size = setup.orientation === 'landscape' ? `${height} ${width}` : `${width} ${height}`
  const margins = marginsOf(setup)
  const [top, , bottom] = margins
  const margin = margins.map((m) => `${Math.round((m / IN) * 1000) / 1000}in`).join(' ')
  const contentHeight = (pageGeometry(setup).pageHeight - top - bottom) / IN
  return [
    `@page { size: ${size}; margin: ${margin}; }`,
    '@page { @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9pt Carlito, Calibri, Arial, sans-serif; color: #605e5c; } }',
    `@media print { :root { --print-content-height: ${Math.floor(contentHeight * 1000) / 1000}in; } }`,
  ].join('\n')
}

/*
 * Layout mode, like Word's View tab: Print layout (pages) or Web layout (one continuous page).
 * Per viewer and per browser.
 */

export type LayoutMode = 'print' | 'web'

const LAYOUT_KEY = 'write:layout'
const layoutMode = createStore<LayoutMode>(readStorage(LAYOUT_KEY) === 'web' ? 'web' : 'print')

export const useLayoutMode = () => useStore(layoutMode)

export function setLayoutMode(mode: LayoutMode) {
  writeStorage(LAYOUT_KEY, mode)
  layoutMode.set(mode)
}

/** Below this width there's no room for a page, so Print layout shows the document continuous, like Word on a phone. */
const NARROW_QUERY = 'screen and (max-width: 900px)'

const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export const useNarrowScreen = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches)

/** Whether the document shows as pages: Print layout, on a screen wide enough for a page. */
export function usePagedView(): boolean {
  const mode = useLayoutMode()
  const narrow = useNarrowScreen()
  return mode === 'print' && !narrow
}
