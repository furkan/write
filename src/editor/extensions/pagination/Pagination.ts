/*
 * Paged ("print layout") editing, rewritten and trimmed from tiptap-pagination-plus
 * https://github.com/RomikMakavana/tiptap-pagination-plus
 * at commit 60dc9d9707526618d8b14889c1d3f41a49191cc5 (tag 3.1.0), src/PaginationPlus.ts and src/utils.ts.
 *
 * MIT License
 *
 * Copyright (c) Romik Makavana
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * How it works (the upstream idea, kept): one widget decoration at the start of the document
 * holds, for every page, a zero-width float whose top margin is the page's content height and,
 * under it, a full-width float (the "break": this page's bottom margin with the page number,
 * the gap between pages, the next page's top margin). Text lines can't overlap floats, so each
 * line that doesn't fit on a page moves below the break, onto the next page. The document is
 * never changed, so this is safe with collaboration: only the decorations differ per viewer.
 *
 * What changed from upstream:
 * - Kept: page size, margins, gap, a "Page N of M" footer and an on/off switch. Dropped:
 *   per-page HTML headers and footers, click callbacks and the hard-break decorations.
 * - Settings live in the plugin state, changed by a transaction (`setPagination`), instead of
 *   mutable extension storage compared field by field on every transaction.
 * - The page count is measured once per frame after the DOM has updated (requestAnimationFrame),
 *   not twice per transaction (once in `apply`, before the DOM even changed). Typing only maps
 *   the existing decorations; they are rebuilt when the page count or the settings change.
 * - Styles live in pagination.css and CSS variables instead of a <style> tag and inline styles
 *   that stayed on the editor after pagination was turned off.
 * - The editor is a flow root, so it contains the floats; no `min-height` bookkeeping.
 * - Something that can't be split and is taller than a page would be pushed below the last page
 *   again and again, adding pages forever (upstream does). Before adding pages, measuring looks at
 *   the first box past the last page: if it's such a box, a table row or task item gets the
 *   `pagination-tall` class (a node decoration) that lets its lines break across pages, and
 *   anything else is left where it is. The class goes again once the box fits on a page.
 * - Table rows are separate boxes, so cells are placed in their columns explicitly (tables.ts).
 */

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import './pagination.css'
import { tableDecorations, touchesTable } from './tables'

/** Page geometry in CSS pixels (96 per inch). */
export type PaginationOptions = {
  enabled: boolean
  pageWidth: number
  pageHeight: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  /** Space between pages on screen (not printed). */
  pageGap: number
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: {
      /** Changes some of the settings; the rest stay as they are. */
      setPagination: (options: Partial<PaginationOptions>) => ReturnType
    }
  }
}

type PaginationState = {
  options: PaginationOptions
  pageCount: number
  /** The pages widget, `pagination-tall` marks (spec.tall) and table cell placement (spec.table). */
  decorations: DecorationSet
}

type PaginationMeta = {
  options?: PaginationOptions
  pageCount?: number
  /** Start positions of unbreakable nodes found to be taller than a page: mark them. */
  tall?: number[]
  /** Start positions of marked nodes that now fit on a page: unmark them. */
  untall?: number[]
}

export const paginationKey = new PluginKey<PaginationState>('pagination')

/** Space between pages on screen, in CSS pixels. */
export const DEFAULT_PAGE_GAP = 24

/**
 * Last-resort guard: how many growth passes in a row may leave the content just as far past the
 * last page. Real growth (loading, images arriving) gets closer on every pass; this only trips for
 * an unbreakable box `stuckBox` doesn't recognise, and it starts over as soon as anything changes.
 */
const MAX_FUTILE_PASSES = 4

/** Unbreakable boxes that can be made breakable when taller than a page (see pagination.css). */
const BREAKABLE_WHEN_TALL = 'tr, ul[data-type="taskList"] > li'
const TALL_CLASS = 'pagination-tall'

const DEFAULTS: PaginationOptions = {
  enabled: true,
  // A4 portrait with 1 inch margins.
  pageWidth: (210 * 96) / 25.4,
  pageHeight: (297 * 96) / 25.4,
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
  pageGap: DEFAULT_PAGE_GAP,
}

const contentHeight = (o: PaginationOptions) => o.pageHeight - o.marginTop - o.marginBottom

const sameOptions = (a: PaginationOptions, b: PaginationOptions) =>
  (Object.keys(a) as (keyof PaginationOptions)[]).every((k) => a[k] === b[k])

const px = (value: number) => `${Math.round(value * 1000) / 1000}px`

/** CSS variables for pagination.css, set on the editor element. */
function cssVariables(o: PaginationOptions): string {
  return [
    `--page-width: ${px(o.pageWidth)}`,
    `--page-height: ${px(o.pageHeight)}`,
    `--page-margin-top: ${px(o.marginTop)}`,
    `--page-margin-right: ${px(o.marginRight)}`,
    `--page-margin-bottom: ${px(o.marginBottom)}`,
    `--page-margin-left: ${px(o.marginLeft)}`,
    `--page-content-height: ${px(contentHeight(o))}`,
    `--page-gap: ${px(o.pageGap)}`,
  ].join('; ')
}

function element(className: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = className
  return div
}

/** The floats that make the pages; see the comment at the top. */
function renderPages(pageCount: number): HTMLElement {
  const root = element('pagination-pages')
  root.contentEditable = 'false'
  root.setAttribute('aria-hidden', 'true')
  for (let page = 1; page <= pageCount; page++) {
    const pageBreak = element('pagination-break')
    const footer = element('pagination-footer')
    const number = document.createElement('span')
    number.className = 'pagination-number'
    number.textContent = `Page ${page} of ${pageCount}`
    footer.append(number)
    pageBreak.append(footer, element('pagination-gap'), element('pagination-header'))
    root.append(element('pagination-spacer'), pageBreak)
  }
  return root
}

const pagesWidget = (pageCount: number) =>
  Decoration.widget(0, () => renderPages(pageCount), {
    side: -1,
    // Same key, same DOM: ProseMirror keeps the existing widget instead of redrawing it.
    key: `pagination-${pageCount}`,
    pages: true,
    ignoreSelection: true,
    stopEvent: () => true,
  })

/** Every decoration from scratch, keeping the given `pagination-tall` marks. */
function buildDecorations(doc: PMNode, options: PaginationOptions, pageCount: number, tall: Decoration[]): DecorationSet {
  if (!options.enabled) return DecorationSet.empty
  return DecorationSet.create(doc, [pagesWidget(pageCount), ...tall, ...tableDecorations(doc)])
}

function tallDecorations(doc: PMNode, positions: number[]): Decoration[] {
  return positions.flatMap((pos) => {
    const node = doc.nodeAt(pos)
    return node ? [Decoration.node(pos, pos + node.nodeSize, { class: TALL_CLASS }, { tall: true })] : []
  })
}

/** The document position where `el` (a node's own DOM) starts, or -1. */
function nodePos(view: EditorView, el: Element): number {
  const pos = view.posAtDOM(el, 0) - 1
  return pos >= 0 && view.nodeDOM(pos) === el ? pos : -1
}

/** Whether the browser can't split `el` across pages: a replaced element, or its own formatting context. */
function unbreakable(el: Element): boolean {
  if (el.matches('img, iframe, video, canvas, svg, hr, input')) return true
  const style = getComputedStyle(el)
  if (!['block', 'list-item', 'inline', 'contents'].includes(style.display)) return true
  return style.overflowX !== 'visible' || style.overflowY !== 'visible'
}

/**
 * The first box (in document order) past the last page, if it can't be split and is taller than a
 * page. Such a box was pushed past the last page because it fits on none, and more pages would
 * only push it again. Anything else past the last page (a paragraph not split yet, a box that
 * fits) means more pages will help.
 */
function stuckBox(view: EditorView, lastPageBottom: number, limit: number): Element | null {
  const search = (parent: Element): Element | null | undefined => {
    for (const child of parent.children) {
      if (child.classList.contains('pagination-pages')) continue
      const rect = child.getBoundingClientRect()
      if (rect.bottom <= lastPageBottom + 1 || rect.height === 0) continue
      if (rect.top >= lastPageBottom - 1) {
        // The first box past the last page decides.
        if (rect.height <= limit + 1) return null
        if (unbreakable(child)) return child
      }
      // Straddles the end of the last page, or is tall but splittable: what's inside decides.
      const inner = search(child)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  return search(view.dom) ?? null
}

/**
 * How many pages the content needs, from where the last block ends, and how far it runs past the
 * last page's content area. Every page has the same geometry, so page `k` (from 1) holds content
 * between `(k-1)·pitch + marginTop` and that plus the content height. Content past the last page
 * isn't broken yet, so the estimate for it may be a little short; the next measurement adds the rest.
 */
function measurePages(view: EditorView, options: PaginationOptions, pageCount: number): { needed: number; overflow: number } {
  const dom = view.dom
  const last = dom.lastElementChild
  if (!last || last.classList.contains('pagination-pages')) return { needed: 1, overflow: 0 }
  const top = dom.getBoundingClientRect().top + dom.clientTop
  const bottom = last.getBoundingClientRect().bottom - top
  const content = contentHeight(options)
  const pitch = options.pageHeight + options.pageGap
  const endOfLastPage = (pageCount - 1) * pitch + options.marginTop + content
  const overflow = bottom - endOfLastPage
  // Half a pixel of slack for subpixel layout.
  if (overflow <= 0.5) return { needed: Math.max(1, Math.ceil((bottom - 0.5 - options.marginTop - content) / pitch) + 1), overflow }
  const belowLastPage = bottom - ((pageCount - 1) * pitch + options.pageHeight)
  return { needed: pageCount + Math.max(1, Math.ceil(belowLastPage / content)), overflow }
}

function paginationPlugin(initial: PaginationOptions): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: (_, state) => ({ options: initial, pageCount: 1, decorations: buildDecorations(state.doc, initial, 1, []) }),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(paginationKey) as PaginationMeta | undefined
        const options = meta?.options ?? prev.options
        const pageCount = meta?.pageCount ?? prev.pageCount
        let decorations = tr.docChanged ? prev.decorations.map(tr.mapping, tr.doc) : prev.decorations
        if (!sameOptions(options, prev.options)) {
          // New geometry: what was too tall may fit now. Measuring finds what still doesn't.
          decorations = buildDecorations(state.doc, options, pageCount, [])
        } else if (options.enabled) {
          const find = (key: 'pages' | 'tall' | 'table') => decorations.find(undefined, undefined, (spec) => spec[key] === true)
          if (pageCount !== prev.pageCount) decorations = decorations.remove(find('pages')).add(state.doc, [pagesWidget(pageCount)])
          if (tr.docChanged && touchesTable(tr)) decorations = decorations.remove(find('table')).add(state.doc, tableDecorations(state.doc))
          if (meta?.untall) {
            const untall = new Set(meta.untall)
            decorations = decorations.remove(find('tall').filter((d) => untall.has(d.from)))
          }
          if (meta?.tall) decorations = decorations.add(state.doc, tallDecorations(state.doc, meta.tall))
        }
        if (decorations === prev.decorations && options === prev.options && pageCount === prev.pageCount) return prev
        return { options, pageCount, decorations }
      },
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.decorations,
      attributes: (state): Record<string, string> => {
        const options = paginationKey.getState(state)?.options
        return options?.enabled ? { class: 'paginated', style: cssVariables(options) } : {}
      },
    },
    view: (view) => {
      let frame = 0
      // Growth passes in a row that left the content just as far past the last page.
      let futile = 0
      let lastOverflow = Number.POSITIVE_INFINITY
      const printing = window.matchMedia('print')
      const dispatch = (meta: PaginationMeta) => view.dispatch(view.state.tr.setMeta(paginationKey, meta))

      const measure = () => {
        frame = 0
        const current = paginationKey.getState(view.state)
        // Print CSS has no gap between pages, so the screen geometry doesn't apply while printing.
        if (!current?.options.enabled || view.isDestroyed || printing.matches) return
        const { options, pageCount } = current
        const limit = contentHeight(options)

        // A marked box that now fits on a page (stacked, so it fits unstacked too): unmark it.
        const untall = [...view.dom.querySelectorAll(`.${TALL_CLASS}`)]
          .filter((el) => el.getBoundingClientRect().height <= limit)
          .map((el) => nodePos(view, el))
          .filter((pos) => pos >= 0)
        if (untall.length) return dispatch({ untall })

        const { needed, overflow } = measurePages(view, options, pageCount)
        if (needed <= pageCount) {
          futile = 0
          lastOverflow = Number.POSITIVE_INFINITY
          if (needed < pageCount) dispatch({ pageCount: needed })
          return
        }

        // Content runs past the last page. If a box taller than a page that can't be split is why,
        // more pages won't help: make it breakable if it's a kind that can be, else leave it.
        const breaks = view.dom.querySelectorAll('.pagination-break')
        const lastPageBottom = breaks[breaks.length - 1]?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY
        const stuck = stuckBox(view, lastPageBottom, limit)
        if (stuck) {
          const pos = stuck.matches(BREAKABLE_WHEN_TALL) ? nodePos(view, stuck) : -1
          if (pos >= 0) dispatch({ tall: [pos] })
          return
        }
        futile = overflow >= lastOverflow - 0.5 ? futile + 1 : 0
        lastOverflow = overflow
        if (futile >= MAX_FUTILE_PASSES) return
        dispatch({ pageCount: needed })
      }
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(measure)
      }
      // Something changed (an edit, an image or font loading, new settings): the guard starts over.
      const changed = () => {
        futile = 0
        lastOverflow = Number.POSITIVE_INFINITY
        schedule()
      }

      // Layout also changes without a transaction: images and fonts load, node views render. (The
      // editor also resizes when pages are added, so a resize alone doesn't reset the guard.)
      const resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(view.dom)
      view.dom.addEventListener('load', changed, true)
      void document.fonts?.ready.then(changed)
      // After printing, measure again in case anything changed under print styles.
      printing.addEventListener('change', schedule)
      schedule()

      return {
        update: (_view, prevState) => {
          const prev = paginationKey.getState(prevState)
          const next = paginationKey.getState(view.state)
          if (!next?.options.enabled) return
          if (view.state.doc !== prevState.doc || !prev || !sameOptions(prev.options, next.options)) changed()
          else if (prev !== next) schedule()
        },
        destroy: () => {
          cancelAnimationFrame(frame)
          resizeObserver.disconnect()
          view.dom.removeEventListener('load', changed, true)
          printing.removeEventListener('change', schedule)
        },
      }
    },
  })
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions: () => DEFAULTS,

  addCommands() {
    return {
      setPagination:
        (options) =>
        ({ state, tr, dispatch }) => {
          const current = paginationKey.getState(state)?.options ?? this.options
          if (dispatch) tr.setMeta(paginationKey, { options: { ...current, ...options } } satisfies PaginationMeta)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [paginationPlugin(this.options)]
  },
})
