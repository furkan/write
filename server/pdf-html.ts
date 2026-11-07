import { getSchema, mergeAttributes } from '@tiptap/core'
import { gitHubEmojis } from '@tiptap/extension-emoji'
import { DOMSerializer, type Schema } from '@tiptap/pm/model'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { Window, type Element } from 'happy-dom'
import katex from 'katex'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, sep } from 'node:path'
import * as Y from 'yjs'
import { CALLOUT_VARIANTS, isVariant } from '../src/editor/extensions/callout-variants.ts'
import { IN, marginsOf, PAPER_SIZES, readPageSetup, type PageSetup } from '../src/editor/paper.ts'
import { documentExtensions, KATEX_OPTIONS, lowlight } from '../src/editor/schema.ts'

/**
 * Turns a stored document (its Yjs state) into one self-contained HTML page for the PDF export
 * (`server/pdf.ts` prints it with headless Chromium). The editor's own schema (`src/editor/schema.ts`)
 * serialises the content, as `@tiptap/html`'s `generateHTML` does, into a happy-dom document with
 * scripts off; then the parts the editor draws with node views or decorations get a static form:
 * KaTeX for math, lowlight for code, emoji characters, the callout icon, task checkboxes.
 *
 * Nothing in the page may load anything: the renderer also blocks every request but `data:` and
 * runs without JavaScript, but the page itself has a Content-Security-Policy and only `data:`
 * URLs. Images linked by URL and YouTube embeds become a placeholder box with the URL as its
 * caption (fetching them would let a document make the server request any URL). Text, attribute
 * values and the title are escaped by the DOM serialiser; links keep only http(s), mailto and tel
 * URLs, and inline styles only a few typographic properties with plain values.
 */

// ---------- Schema ----------

/**
 * The editor's schema. Emoji render as their character: the editor's renderer asks the browser
 * whether it can draw them (a canvas test), and falls back to images from a CDN otherwise.
 */
function serverExtensions() {
  const extensions = documentExtensions()
  return Object.values({
    ...extensions,
    emoji: extensions.emoji.extend({
      renderHTML({ node, HTMLAttributes }) {
        const name = String(node.attrs.name ?? '')
        const item = gitHubEmojis.find((emoji) => emoji.name === name || emoji.shortcodes.includes(name))
        return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'emoji' }), item?.emoji ?? `:${name}:`]
      },
    }),
  })
}

let cachedSchema: Schema | undefined
const schema = () => (cachedSchema ??= getSchema(serverExtensions()))

// ---------- Static assets ----------

const require = createRequire(import.meta.url)
/** The app's `public/` folder: images like the welcome document's `/sample.svg` are inlined from it. */
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')
const STYLESHEET = join(import.meta.dirname, 'pdf.css')

let katexCss: string | undefined
/** KaTeX's stylesheet with its fonts inlined as `data:` URLs (woff2 only: Chromium reads it). */
function katexStylesheet() {
  if (katexCss !== undefined) return katexCss
  const dist = dirname(require.resolve('katex'))
  const css = readFileSync(join(dist, 'katex.min.css'), 'utf8')
  katexCss = css.replace(/src:\s*url\(fonts\/([\w-]+)\.woff2\)\s*format\(["']woff2["']\)[^;}]*/g, (_, name: string) => {
    const font = readFileSync(join(dist, 'fonts', `${name}.woff2`)).toString('base64')
    return `src:url(data:font/woff2;base64,${font}) format("woff2")`
  })
  return katexCss
}

let carlitoCss: string | undefined
/**
 * The page font, Carlito (metric-compatible with Calibri), as `@font-face` rules with the fonts
 * inlined as `data:` URLs: the page may not load anything, and the machine may not have it.
 * Latin and Latin Extended only (about 0.5 MB base64); other scripts fall back to Arial.
 */
function fontStylesheet() {
  if (carlitoCss !== undefined) return carlitoCss
  const dist = dirname(require.resolve('@fontsource/carlito/package.json'))
  carlitoCss = ['latin', 'latin-ext']
    .flatMap((subset) => ['400', '400-italic', '700', '700-italic'].map((weight) => `${subset}-${weight}`))
    .map((name) =>
      readFileSync(join(dist, `${name}.css`), 'utf8').replace(/src:\s*url\(\.\/files\/([\w-]+)\.woff2\)[^;}]*/g, (_, file: string) => {
        const font = readFileSync(join(dist, 'files', `${file}.woff2`)).toString('base64')
        return `src:url(data:font/woff2;base64,${font}) format("woff2")`
      }),
    )
    .join('\n')
  return carlitoCss
}

let pdfCss: string | undefined
const pdfStylesheet = () => (pdfCss ??= readFileSync(STYLESHEET, 'utf8'))

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/** A `data:` URL for an image in `public/` named by a root-relative path like `/sample.svg`, if there is one. */
function publicImage(src: string): string | undefined {
  if (!/^\/[\w.-]+(?:\/[\w.-]+)*$/.test(src) || src.includes('..')) return undefined
  const type = IMAGE_TYPES[extname(src).toLowerCase()]
  if (!type) return undefined
  const file = normalize(join(PUBLIC_DIR, src))
  if (!file.startsWith(PUBLIC_DIR + sep)) return undefined
  try {
    return `data:${type};base64,${readFileSync(file).toString('base64')}`
  } catch {
    return undefined
  }
}

// ---------- Sanitising ----------

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)(?:;[\w=.+-]+)*,/i
const SAFE_LINK = /^(?:https?:|mailto:|tel:|#)/i

/** Inline style properties the editor sets (text style, highlight, alignment); everything else is dropped. */
const STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'text-align',
  'text-decoration',
  // Paragraph formatting: spacing and indents.
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'text-indent',
])

/** Keeps `prop: value` pairs with allowed properties and plain values: no `url()`, no escapes, no at-rules. */
export function cleanStyle(style: string) {
  return style
    .split(';')
    .map((declaration) => {
      const colon = declaration.indexOf(':')
      if (colon < 0) return ''
      const property = declaration.slice(0, colon).trim().toLowerCase()
      const value = declaration.slice(colon + 1).trim()
      if (!STYLE_PROPERTIES.has(property) || !value) return ''
      if (!/^[\w\s#%.,'"()+-]*$/.test(value) || /\(/.test(value.replace(/\b(?:rgba?|hsla?|var)\(/gi, ''))) return ''
      return `${property}: ${value}`
    })
    .filter(Boolean)
    .join('; ')
}

const REMOVED_ELEMENTS = 'script, style, link, meta, base, iframe, frame, object, embed, form, input, textarea, select, button, video, audio, source, svg, math'

type El = Element

function sanitize(root: El) {
  for (const element of root.querySelectorAll(REMOVED_ELEMENTS)) element.remove()
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const { name, value: raw } of [...element.attributes]) {
      const value = raw ?? ''
      if (name.startsWith('on') || name === 'srcset' || name === 'contenteditable') element.removeAttribute(name)
      else if (name === 'style') {
        // Column proportions from `renderTables`.
        if (element.tagName === 'COL' && /^width: \d+(?:\.\d+)?%$/.test(value)) continue
        const style = cleanStyle(value)
        if (style) element.setAttribute('style', style)
        else element.removeAttribute('style')
      } else if (name === 'href' && !(element.tagName === 'A' && SAFE_LINK.test(value.trim()))) element.removeAttribute(name)
      else if (name === 'src' && !(element.tagName === 'IMG' && DATA_IMAGE.test(value))) element.removeAttribute(name)
    }
  }
}

// ---------- Static renderers ----------

/** A box standing in for something the PDF can't show: an image linked by URL, a video. */
function placeholder(document: Window['document'], label: string, url: string) {
  const box = document.createElement('div')
  box.className = 'pdf-placeholder'
  const title = document.createElement('div')
  title.className = 'pdf-placeholder-label'
  title.textContent = label
  box.append(title)
  if (url) {
    const caption = document.createElement('div')
    caption.className = 'pdf-placeholder-url'
    caption.textContent = url
    box.append(caption)
  }
  return box
}

/** Embedded images stay (and the app's own, inlined); images linked by URL become placeholders. Runs before `sanitize`. */
function renderImages(root: El, document: Window['document']) {
  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    const inlined = DATA_IMAGE.test(src) ? src : publicImage(src)
    if (inlined) {
      image.setAttribute('src', inlined)
      continue
    }
    const alt = image.getAttribute('alt')?.trim()
    image.replaceWith(placeholder(document, alt ? `Image: ${alt}` : 'Image', src))
  }
}

/** The width an image was resized to, as a style `sanitize` would drop; pdf.css keeps it within the page. */
function sizeImages(root: El) {
  for (const image of root.querySelectorAll('img')) {
    const width = Number(image.getAttribute('width'))
    image.removeAttribute('width')
    image.removeAttribute('height')
    if (Number.isFinite(width) && width > 0) image.setAttribute('style', `width: ${Math.round(width)}px`)
  }
}

/** Runs before `sanitize`, which removes iframes. */
function renderVideos(root: El, document: Window['document']) {
  for (const video of root.querySelectorAll('div[data-youtube-video]')) {
    const src = video.querySelector('iframe')?.getAttribute('src') ?? ''
    const id = /\/embed\/([\w-]+)/.exec(src)?.[1]
    video.replaceWith(placeholder(document, 'YouTube video', id ? `https://www.youtube.com/watch?v=${id}` : src))
  }
}

/** Longer formulas print as their LaTeX source: KaTeX's output is about 80 times its input. */
export const MAX_FORMULA_CHARS = 4000
/** LaTeX rendered per document; formulas after that print as their source. */
const MATH_BUDGET_CHARS = 100_000
const KATEX_LIMITS = { maxSize: 20, maxExpand: 500 }

/** A formula that isn't rendered: its LaTeX, as text the reader can still use. */
function mathSource(element: El, latex: string, document: Window['document']) {
  const source = document.createElement('code')
  source.className = 'math-source'
  source.textContent = latex
  element.textContent = ''
  element.append(source)
}

/**
 * Math by KaTeX. Block math is laid out like display math (`\displaystyle`), but in KaTeX's
 * inline mode, so a formula wider than the text wraps at its operators instead of running off the
 * page. A formula KaTeX can't render (e.g. a stack overflow on deep nesting: `throwOnError` only
 * covers parse errors), or one over the size limits, prints as its source.
 */
function renderMath(root: El, document: Window['document']) {
  let budget = MATH_BUDGET_CHARS
  for (const element of root.querySelectorAll('[data-type="inline-math"], [data-type="block-math"]')) {
    const latex = element.getAttribute('data-latex') ?? ''
    const block = element.getAttribute('data-type') === 'block-math'
    // The rendered formula (or its source) is all the page needs: don't print the LaTeX twice.
    element.removeAttribute('data-latex')
    if (latex.length > MAX_FORMULA_CHARS || latex.length > budget) {
      mathSource(element, latex, document)
      continue
    }
    budget -= latex.length
    try {
      // KaTeX escapes its input; `trust` stays off, so \href, \url and friends render as text.
      element.innerHTML = katex.renderToString(block ? `\\displaystyle ${latex}` : latex, {
        ...KATEX_OPTIONS,
        ...KATEX_LIMITS,
        displayMode: false,
        output: 'html',
        strict: 'ignore',
        trust: false,
      })
    } catch {
      mathSource(element, latex, document)
    }
  }
}

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] }

function appendHast(parent: El, nodes: HastNode[], document: Window['document']) {
  for (const node of nodes) {
    if (node.type === 'text') parent.append(document.createTextNode(node.value ?? ''))
    else if (node.type === 'element') {
      const span = document.createElement('span')
      const classes = node.properties?.className
      if (classes?.length) span.className = classes.join(' ')
      appendHast(span, node.children ?? [], document)
      parent.append(span)
    }
  }
}

/** Code blocks larger than this print without highlighting. */
export const MAX_HIGHLIGHT_CHARS = 100_000
/** Code highlighted per document; blocks after that print plain. */
const HIGHLIGHT_BUDGET_CHARS = 400_000

/**
 * Syntax highlighting for the block's language. Unlike the editor, a block with no or an unknown
 * language isn't guessed (`highlightAuto` runs every grammar over it), and large blocks print plain.
 */
function renderCode(root: El, document: Window['document']) {
  let budget = HIGHLIGHT_BUDGET_CHARS
  for (const code of root.querySelectorAll('pre > code')) {
    const text = code.textContent ?? ''
    const language = /(?:^|\s)language-(\S+)/.exec(code.getAttribute('class') ?? '')?.[1]
    if (!language || !lowlight.registered(language) || text.length > MAX_HIGHLIGHT_CHARS || text.length > budget) continue
    budget -= text.length
    const tree = lowlight.highlight(language, text)
    code.textContent = ''
    appendHast(code, tree.children as HastNode[], document)
  }
}

function renderCallouts(root: El, document: Window['document']) {
  for (const callout of root.querySelectorAll('div[data-type="callout"]')) {
    const variant = callout.getAttribute('data-variant')
    const icon = document.createElement('span')
    icon.className = 'callout-icon'
    icon.textContent = CALLOUT_VARIANTS[isVariant(variant) ? variant : 'info'].icon
    const content = document.createElement('div')
    content.className = 'callout-content'
    content.append(...callout.childNodes)
    callout.append(icon, content)
    callout.classList.add('callout')
  }
}

/** Task checkboxes are drawn by pdf.css, not as form fields. */
function renderTasks(root: El, document: Window['document']) {
  for (const item of root.querySelectorAll('li[data-type="taskItem"]')) {
    const label = item.querySelector(':scope > label')
    if (!label) continue
    const box = document.createElement('span')
    box.className = 'task-box'
    label.replaceWith(box)
  }
}

/**
 * Tables: header rows go in a `<thead>`, which Chromium repeats on every page, and column widths
 * set by resizing become proportions, so a wide table fits the page instead of running off it.
 */
function renderTables(root: El, document: Window['document']) {
  for (const table of root.querySelectorAll('table')) {
    table.removeAttribute('style')
    const cols = [...table.querySelectorAll(':scope > colgroup > col')]
    const widths = cols.map((col) => parseFloat(/width:\s*([\d.]+)px/.exec(col.getAttribute('style') ?? '')?.[1] ?? ''))
    const total = widths.reduce((sum, width) => sum + width, 0)
    cols.forEach((col, i) => {
      if (widths.every((width) => width > 0)) col.setAttribute('style', `width: ${((widths[i] / total) * 100).toFixed(3)}%`)
      else col.removeAttribute('style')
    })
    const body = table.querySelector(':scope > tbody')
    if (!body) continue
    const head = document.createElement('thead')
    for (const row of [...body.children]) {
      const cells = [...row.children]
      if (!cells.length || cells.some((cell) => cell.tagName !== 'TH')) break
      head.append(row)
    }
    if (head.children.length) table.insertBefore(head, body)
  }
}

// ---------- Page ----------

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * The page setup as `@page` rules, the same way the editor prints (page-setup.ts `pageRules`):
 * size and margins in one rule and the "Page N of M" footer in another.
 */
export function pageCss(setup: PageSetup) {
  const [width, height] = PAPER_SIZES[setup.size].css
  const size = setup.orientation === 'landscape' ? `${height} ${width}` : `${width} ${height}`
  const margins = marginsOf(setup)
  const paper = PAPER_SIZES[setup.size]
  const pageHeight = setup.orientation === 'landscape' ? paper.width : paper.height
  const contentHeight = (pageHeight - margins[0] - margins[2]) / IN
  return [
    `@page { size: ${size}; margin: ${margins.map((m) => `${Math.round((m / IN) * 1000) / 1000}in`).join(' ')}; }`,
    '@page { @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9pt Carlito, Calibri, Arial, sans-serif; color: #605e5c; } }',
    `:root { --content-height: ${Math.floor(contentHeight * 1000) / 1000}in; }`,
  ].join('\n')
}

/** Only `data:` images, fonts and the inline stylesheets: no requests, no scripts. */
const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"

export type PdfPage = { html: string; title: string; setup: PageSetup }

/** The document's title, for the file name and the PDF's metadata. */
export const docTitle = (doc: Y.Doc) => {
  const title = doc.getMap('meta').get('title')
  return typeof title === 'string' ? title.trim() : ''
}

/** Builds the PDF's HTML page from a document's Yjs state. */
export function documentPage(state: Uint8Array | null): PdfPage {
  const doc = new Y.Doc()
  if (state) Y.applyUpdate(doc, state)
  const setup = readPageSetup(doc.getMap('meta'))
  const title = docTitle(doc)
  // A copy of the stored state: this may drop content that doesn't fit the schema from it.
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('default'), schema())
  doc.destroy()

  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
    },
  })
  try {
    const { document } = window
    const main = document.createElement('main')
    main.className = 'tiptap'
    DOMSerializer.fromSchema(schema()).serializeFragment(root.content, { document: document as unknown as globalThis.Document }, main as unknown as HTMLElement)
    // Placeholders read the URLs `sanitize` removes, and tables the column widths it would drop;
    // then the document's markup is sanitised, and the static renderers after it only add
    // trusted markup.
    renderVideos(main, document)
    renderImages(main, document)
    renderTables(main, document)
    sanitize(main)
    sizeImages(main)
    renderCode(main, document)
    renderCallouts(main, document)
    renderTasks(main, document)
    const hasMath = main.querySelector('[data-type="inline-math"], [data-type="block-math"]') !== null
    renderMath(main, document)
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
      `<title>${escapeHtml(title || 'Untitled document')}</title>`,
      `<style>${fontStylesheet()}\n${pdfStylesheet()}\n${pageCss(setup)}</style>`,
      hasMath ? `<style>${katexStylesheet()}</style>` : '',
      '</head>',
      `<body>${main.outerHTML}</body>`,
      '</html>',
    ].join('\n')
    return { html, title, setup }
  } finally {
    window.happyDOM.abort()
    void window.happyDOM.close()
  }
}
