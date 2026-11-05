import { useEffect, useState, useSyncExternalStore } from 'react'
import { createStore, useStore } from '../store'
import type { Session } from './collab'
import type { PaginationOptions } from './extensions/pagination/Pagination'
import { readStorage, writeStorage } from './storage'

/*
 * Page setup belongs to the document (like Word's Layout tab): size, orientation and margins are
 * kept in the shared `meta` map next to the title, so they sync and persist. A missing or unknown
 * value means the default, so documents from before this, and new ones, are A4 portrait with
 * normal margins. How you look at the document (pages or one long page) is your own preference.
 */

export type PaperSize = 'a4' | 'letter' | 'legal' | 'a5'
export type Orientation = 'portrait' | 'landscape'
export type MarginPreset = 'normal' | 'narrow' | 'wide'
export type PageSetup = { size: PaperSize; orientation: Orientation; margins: MarginPreset }

const MM = 96 / 25.4
const IN = 96

/** Portrait width and height in CSS pixels, and in physical units for the printer. */
export const PAPER_SIZES: Record<PaperSize, { label: string; detail: string; width: number; height: number; css: [string, string] }> = {
  a4: { label: 'A4', detail: '21 × 29.7 cm', width: 210 * MM, height: 297 * MM, css: ['210mm', '297mm'] },
  letter: { label: 'Letter', detail: '8.5 × 11 in', width: 8.5 * IN, height: 11 * IN, css: ['8.5in', '11in'] },
  legal: { label: 'Legal', detail: '8.5 × 14 in', width: 8.5 * IN, height: 14 * IN, css: ['8.5in', '14in'] },
  a5: { label: 'A5', detail: '14.8 × 21 cm', width: 148 * MM, height: 210 * MM, css: ['148mm', '210mm'] },
}

/** Word's presets: top, right, bottom, left. */
export const MARGIN_PRESETS: Record<MarginPreset, { label: string; detail: string; margins: [number, number, number, number] }> = {
  normal: { label: 'Normal', detail: '1 in all round', margins: [IN, IN, IN, IN] },
  narrow: { label: 'Narrow', detail: '0.5 in all round', margins: [IN / 2, IN / 2, IN / 2, IN / 2] },
  wide: { label: 'Wide', detail: '1 in top and bottom, 2 in sides', margins: [IN, 2 * IN, IN, 2 * IN] },
}

export const ORIENTATIONS: Record<Orientation, { label: string }> = {
  portrait: { label: 'Portrait' },
  landscape: { label: 'Landscape' },
}

export const DEFAULT_PAGE_SETUP: PageSetup = { size: 'a4', orientation: 'portrait', margins: 'normal' }

const KEYS = { size: 'pageSize', orientation: 'pageOrientation', margins: 'pageMargins' } as const

const oneOf = <T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T =>
  typeof value === 'string' && Object.hasOwn(options, value) ? (value as T) : fallback

/** Reads the page setup from the shared document; anything missing or unknown is the default. */
export function getPageSetup(session: Session): PageSetup {
  const { meta } = session
  return {
    size: oneOf(meta.get(KEYS.size), PAPER_SIZES, DEFAULT_PAGE_SETUP.size),
    orientation: oneOf(meta.get(KEYS.orientation), ORIENTATIONS, DEFAULT_PAGE_SETUP.orientation),
    margins: oneOf(meta.get(KEYS.margins), MARGIN_PRESETS, DEFAULT_PAGE_SETUP.margins),
  }
}

/** Changes the page setup for everyone. The server drops a viewer's writes, so only offer it to editors. */
export function setPageSetup(session: Session, change: Partial<PageSetup>) {
  session.ydoc.transact(() => {
    for (const key of Object.keys(change) as (keyof PageSetup)[]) {
      const value = change[key]
      if (value) session.meta.set(KEYS[key], value)
    }
  })
}

/** The page setup, live across collaborators. */
export function usePageSetup(session: Session): PageSetup {
  const [setup, setSetup] = useState(() => getPageSetup(session))
  useEffect(() => {
    const update = () =>
      setSetup((prev) => {
        const next = getPageSetup(session)
        return prev.size === next.size && prev.orientation === next.orientation && prev.margins === next.margins ? prev : next
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
  const [marginTop, marginRight, marginBottom, marginLeft] = MARGIN_PRESETS[setup.margins].margins
  return {
    pageWidth: landscape ? paper.height : paper.width,
    pageHeight: landscape ? paper.width : paper.height,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
  }
}

/** The `@page` rule that makes printed sheets match the page setup. */
export function pageRule(setup: PageSetup, paged: boolean): string {
  const [width, height] = PAPER_SIZES[setup.size].css
  const size = setup.orientation === 'landscape' ? `${height} ${width}` : `${width} ${height}`
  // Paged: the editor already draws the margins and page numbers, so the sheet has none.
  // Continuous: the printer splits the document into pages with the document's margins.
  const margin = paged ? '0' : MARGIN_PRESETS[setup.margins].margins.map((m) => `${m / IN}in`).join(' ')
  return `@page { size: ${size}; margin: ${margin}; }`
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
