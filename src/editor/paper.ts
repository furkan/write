/*
 * Page setup values, shared by the editor (page-setup.ts) and the server's PDF export
 * (server/pdf-html.ts), so no React and no DOM here. Page setup belongs to the document (like
 * Word's Layout tab): size, orientation and margins are kept in the shared `meta` map next to the
 * title. A missing or unknown value means the default, so documents from before this, and new
 * ones, are A4 portrait with normal margins.
 */

export type PaperSize = 'a4' | 'letter' | 'legal' | 'a5'
export type Orientation = 'portrait' | 'landscape'
export type MarginPreset = 'normal' | 'narrow' | 'wide'
export type Margins = readonly [top: number, right: number, bottom: number, left: number]
/** `custom` is what dragging a margin on the ruler makes: `customMargins` (CSS px) then applies. */
export type PageSetup = { size: PaperSize; orientation: Orientation; margins: MarginPreset | 'custom'; customMargins?: Margins }

const MM = 96 / 25.4
/** CSS pixels per inch. */
export const IN = 96

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

/** Where each setting lives in the document's `meta` map. Custom margins are "top,right,bottom,left" in px. */
export const PAGE_SETUP_KEYS = {
  size: 'pageSize',
  orientation: 'pageOrientation',
  margins: 'pageMargins',
  customMargins: 'pageMarginValues',
} as const

/** The largest margin the ruler can make: 3 inches. */
export const MAX_MARGIN = 3 * IN

/** Top, right, bottom and left margins in CSS px: the preset's, or the custom ones. */
export function marginsOf(setup: PageSetup): Margins {
  if (setup.margins === 'custom' && setup.customMargins) return setup.customMargins
  // `custom` without values reads as the default, as an unknown value does.
  return MARGIN_PRESETS[setup.margins === 'custom' ? 'normal' : setup.margins].margins
}

export const serializeMargins = (margins: Margins) => margins.map((m) => Math.round(m * 10) / 10).join(',')

function parseMargins(value: unknown): Margins | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value.split(',').map(Number)
  return parts.length === 4 && parts.every((m) => Number.isFinite(m) && m >= 0 && m <= MAX_MARGIN) ? (parts as unknown as Margins) : undefined
}

const oneOf = <T extends string>(value: unknown, options: Record<T, unknown>, fallback: T): T =>
  typeof value === 'string' && Object.hasOwn(options, value) ? (value as T) : fallback

/** Reads the page setup from a document's `meta` map; anything missing or unknown is the default. */
export function readPageSetup(meta: { get: (key: string) => unknown }): PageSetup {
  const customMargins = parseMargins(meta.get(PAGE_SETUP_KEYS.customMargins))
  const margins = meta.get(PAGE_SETUP_KEYS.margins)
  const size = oneOf(meta.get(PAGE_SETUP_KEYS.size), PAPER_SIZES, DEFAULT_PAGE_SETUP.size)
  const orientation = oneOf(meta.get(PAGE_SETUP_KEYS.orientation), ORIENTATIONS, DEFAULT_PAGE_SETUP.orientation)
  if (margins === 'custom' && customMargins) return { size, orientation, margins, customMargins }
  return { size, orientation, margins: oneOf(margins, MARGIN_PRESETS, 'normal') }
}
