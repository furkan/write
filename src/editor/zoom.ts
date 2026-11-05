import { createStore, useStore } from '../store'
import { readStorage, writeStorage } from './storage'

/*
 * Zoom, like Word's: how large you see the document, from 50% to 200%. Yours only, remembered per
 * browser, never stored in the document; printing always uses 100%. Besides a percentage, Print
 * layout can fit the page to the window: `page-width` (the page's width fills the column) or
 * `one-page` (a whole page fits on screen). A fit follows the window as it resizes.
 *
 * The document is scaled with CSS `zoom` on the editor (see App.css): unlike `transform: scale`,
 * the page then takes its zoomed size in the layout (scrolling, centring), and the browser maps
 * clicks, carets and selection rectangles through it, so ProseMirror and the floating menus need
 * nothing special. Pagination divides its measurements by the scale.
 */

export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10
/** The menus' presets. */
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const

export type ZoomFit = 'page-width' | 'one-page'
export type ZoomSetting = { percent: number; fit: ZoomFit | null }

const KEY = 'write:zoom'

export const clampZoom = (percent: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)))

function read(): ZoomSetting {
  const saved = readStorage(KEY) ?? ''
  if (saved === 'page-width' || saved === 'one-page') return { percent: 100, fit: saved }
  const percent = Number(saved)
  return { percent: Number.isFinite(percent) && percent > 0 ? clampZoom(percent) : 100, fit: null }
}

const zoom = createStore<ZoomSetting>(read())

export const useZoomSetting = () => useStore(zoom)

/** A fixed percentage (ends a fit). */
export function setZoom(percent: number) {
  const next = clampZoom(percent)
  writeStorage(KEY, String(next))
  zoom.set({ percent: next, fit: null })
}

/** Fit the page to the window (Print layout only; elsewhere the last percentage applies). */
export function setZoomFit(fit: ZoomFit) {
  writeStorage(KEY, fit)
  zoom.set({ ...zoom.get(), fit })
}

/** One step in or out from what is shown now, landing on a multiple of the step (137% → 140% or 130%). */
export function stepZoom(current: number, direction: 1 | -1) {
  const base = direction > 0 ? Math.floor(current / ZOOM_STEP) : Math.ceil(current / ZOOM_STEP)
  setZoom((base + direction) * ZOOM_STEP)
}

type FitInput = {
  fit: ZoomFit
  /** The page in layout pixels. */
  pageWidth: number
  pageHeight: number
  /** The room the page has on screen, in screen pixels. */
  width: number
  height: number
}

/** The percentage that fits the page into the room it has. */
export function fitZoom({ fit, pageWidth, pageHeight, width, height }: FitInput): number {
  const byWidth = width / pageWidth
  const scale = fit === 'page-width' ? byWidth : Math.min(byWidth, height / pageHeight)
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.floor(scale * 100)))
}
