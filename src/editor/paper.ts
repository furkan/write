/*
 * Page setup values, shared by the editor (page-setup.ts) and the server's PDF export
 * (server/pdf-html.ts), so no React and no DOM here. Page setup belongs to the document (like
 * Word's Layout tab): size, orientation and margins are kept in the shared `meta` map next to the
 * title. A missing or unknown value means the default, so documents from before this, and new
 * ones, are A4 portrait with normal margins.
 */

export type PaperSize = 'a4' | 'letter' | 'legal' | 'a5'
export type Orientation = 'portrait' | 'landscape'
export type MarginPreset = 'normal' | 'narrow' | 'moderate' | 'wide'
export type Margins = readonly [top: number, right: number, bottom: number, left: number]
/** `custom` is what the Custom margins dialog makes: `customMargins` (CSS px) then applies. */
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
  moderate: { label: 'Moderate', detail: '1 in top and bottom, 0.75 in sides', margins: [IN, 0.75 * IN, IN, 0.75 * IN] },
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

/** The largest margin: 3 inches. */
export const MAX_MARGIN = 3 * IN

/** Top, right, bottom and left margins in CSS px: the preset's, or the custom ones. */
export function marginsOf(setup: PageSetup): Margins {
  if (setup.margins === 'custom' && setup.customMargins) return fitMargins(setup, setup.customMargins)
  // `custom` without values reads as the default, as an unknown value does.
  return MARGIN_PRESETS[setup.margins === 'custom' ? 'normal' : setup.margins].margins
}

/**
 * Custom margins were chosen for some paper; on a smaller one (A4 to A5, or landscape) they could
 * leave no text. Where less than MIN_TEXT of width or height would remain, the pair of margins is
 * scaled down together to leave exactly that.
 */
export function fitMargins(setup: Pick<PageSetup, 'size' | 'orientation'>, [top, right, bottom, left]: Margins): Margins {
  const paper = PAPER_SIZES[setup.size]
  const landscape = setup.orientation === 'landscape'
  const [width, height] = landscape ? [paper.height, paper.width] : [paper.width, paper.height]
  const fit = (a: number, b: number, room: number): [number, number] => {
    const allowed = Math.max(0, room - MIN_TEXT)
    return a + b <= allowed ? [a, b] : [(a * allowed) / (a + b), (b * allowed) / (a + b)]
  }
  const [l, r] = fit(left, right, width)
  const [t, b] = fit(top, bottom, height)
  return [t, r, b, l]
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

export type MarginUnit = 'cm' | 'in'

/** Margins are entered in the paper's own unit: A4 and A5 in cm, Letter and Legal in inches (as Word follows the region). */
export const marginUnit = (size: PaperSize): MarginUnit => (size === 'a4' || size === 'a5' ? 'cm' : 'in')

export const PX_PER_UNIT: Record<MarginUnit, number> = { cm: IN / 2.54, in: IN }

/** The least text the page keeps: an inch each way. */
export const MIN_TEXT = IN

export type MarginErrors = Partial<Record<'top' | 'bottom' | 'left' | 'right' | 'width' | 'height', string>>

/**
 * Checks margins (top, right, bottom, left in px) against the page: each between 0 and 3 inches,
 * and at least an inch of text width and height left. Returns messages by field; empty when fine.
 */
export function validateMargins(setup: Pick<PageSetup, 'size' | 'orientation'>, margins: readonly (number | null)[], unit: MarginUnit = marginUnit(setup.size)): MarginErrors {
  const paper = PAPER_SIZES[setup.size]
  const landscape = setup.orientation === 'landscape'
  const [pageWidth, pageHeight] = landscape ? [paper.height, paper.width] : [paper.width, paper.height]
  const max = Math.round((MAX_MARGIN / PX_PER_UNIT[unit]) * 100) / 100
  const errors: MarginErrors = {}
  const names = ['top', 'right', 'bottom', 'left'] as const
  names.forEach((name, i) => {
    const m = margins[i]
    if (m === null || !Number.isFinite(m)) errors[name] = `Enter a number for the ${name} margin.`
    else if (m < -1e-6 || m > MAX_MARGIN + 1e-6) errors[name] = `The ${name} margin must be between 0 and ${max} ${unit}.`
  })
  const [top, right, bottom, left] = margins
  if (!errors.left && !errors.right && pageWidth - (left as number) - (right as number) < MIN_TEXT - 1e-6)
    errors.width = `Left and right margins leave too little text width: keep at least ${Math.round((MIN_TEXT / PX_PER_UNIT[unit]) * 100) / 100} ${unit}.`
  if (!errors.top && !errors.bottom && pageHeight - (top as number) - (bottom as number) < MIN_TEXT - 1e-6)
    errors.height = `Top and bottom margins leave too little text height: keep at least ${Math.round((MIN_TEXT / PX_PER_UNIT[unit]) * 100) / 100} ${unit}.`
  return errors
}
