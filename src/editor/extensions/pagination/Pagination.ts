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
 * - A guard stops the page count from growing forever when something can't be split and is
 *   taller than a page (upstream would keep adding pages).
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import './pagination.css'

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
  decorations: DecorationSet
}

type PaginationMeta = { options?: PaginationOptions; pageCount?: number }

export const paginationKey = new PluginKey<PaginationState>('pagination')

/**
 * How many times the page count may grow in a row without the document changing. Loading a long
 * document needs two or three passes; more means something taller than a page keeps getting
 * pushed below the last page.
 */
const MAX_GROWTH_PASSES = 6

const DEFAULTS: PaginationOptions = {
  enabled: true,
  // A4 portrait with 1 inch margins.
  pageWidth: (210 * 96) / 25.4,
  pageHeight: (297 * 96) / 25.4,
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
  pageGap: 24,
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

function buildDecorations(state: EditorState, options: PaginationOptions, pageCount: number): DecorationSet {
  if (!options.enabled) return DecorationSet.empty
  const widget = Decoration.widget(0, () => renderPages(pageCount), {
    side: -1,
    // Same key, same DOM: ProseMirror keeps the existing widget instead of redrawing it.
    key: `pagination-${pageCount}`,
    ignoreSelection: true,
    stopEvent: () => true,
  })
  return DecorationSet.create(state.doc, [widget])
}

/**
 * How many pages the content needs, from where the last block ends. Every page has the same
 * geometry, so page `k` (from 1) holds content between `(k-1)·pitch + marginTop` and that plus
 * the content height. Content past the last page isn't broken yet, so the estimate for it may be
 * a little short; the next measurement adds the rest.
 */
function neededPages(view: EditorView, options: PaginationOptions, pageCount: number): number {
  const dom = view.dom
  const last = dom.lastElementChild
  if (!last || last.classList.contains('pagination-pages')) return 1
  const top = dom.getBoundingClientRect().top + dom.clientTop
  const bottom = last.getBoundingClientRect().bottom - top
  const content = contentHeight(options)
  const pitch = options.pageHeight + options.pageGap
  const endOfLastPage = (pageCount - 1) * pitch + options.marginTop + content
  // Half a pixel of slack for subpixel layout.
  if (bottom <= endOfLastPage + 0.5) {
    return Math.max(1, Math.ceil((bottom - 0.5 - options.marginTop - content) / pitch) + 1)
  }
  const belowLastPage = bottom - ((pageCount - 1) * pitch + options.pageHeight)
  return pageCount + Math.max(1, Math.ceil(belowLastPage / content))
}

function paginationPlugin(initial: PaginationOptions): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: (_, state) => ({ options: initial, pageCount: 1, decorations: buildDecorations(state, initial, 1) }),
      apply: (tr, prev, _old, state) => {
        const meta = tr.getMeta(paginationKey) as PaginationMeta | undefined
        const options = meta?.options ?? prev.options
        const pageCount = meta?.pageCount ?? prev.pageCount
        if (pageCount !== prev.pageCount || !sameOptions(options, prev.options)) {
          return { options, pageCount, decorations: buildDecorations(state, options, pageCount) }
        }
        if (!tr.docChanged) return prev
        return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) }
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
      let growthPasses = 0

      const measure = () => {
        frame = 0
        const current = paginationKey.getState(view.state)
        if (!current?.options.enabled || view.isDestroyed) return
        const needed = neededPages(view, current.options, current.pageCount)
        if (needed === current.pageCount) return
        if (needed > current.pageCount && ++growthPasses > MAX_GROWTH_PASSES) return
        view.dispatch(view.state.tr.setMeta(paginationKey, { pageCount: needed } satisfies PaginationMeta))
      }
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(measure)
      }

      // Layout also changes without a transaction: images and fonts load, node views render.
      const resizeObserver = new ResizeObserver(schedule)
      resizeObserver.observe(view.dom)
      view.dom.addEventListener('load', schedule, true)
      void document.fonts?.ready.then(schedule)
      schedule()

      return {
        update: (_view, prevState) => {
          const prev = paginationKey.getState(prevState)
          const next = paginationKey.getState(view.state)
          if (!next?.options.enabled) return
          const optionsChanged = !prev || !sameOptions(prev.options, next.options)
          if (view.state.doc !== prevState.doc || optionsChanged) growthPasses = 0
          if (view.state.doc !== prevState.doc || optionsChanged || prev?.pageCount !== next.pageCount) schedule()
        },
        destroy: () => {
          cancelAnimationFrame(frame)
          resizeObserver.disconnect()
          view.dom.removeEventListener('load', schedule, true)
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
