/**
 * Download as PDF (`GET /api/docs/:id/pdf`), end to end in Dev mode (`vite` on 5180/1240), plus
 * the HTML builder and the renderer on their own. Needs Playwright's Chromium headless shell (or
 * `WRITE_PDF_CHROMIUM`); the poppler tools (`pdfinfo`, `pdftotext`) for the page geometry checks.
 *
 * alice owns the documents, bob is an editor, carol a viewer and mallory a stranger.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docFileName, pdfDisposition } from '../server/collab.ts'
import { cleanStyle, documentPage, MAX_FORMULA_CHARS, MAX_HIGHLIGHT_CHARS } from '../server/pdf-html.ts'
import { createPdfRenderer, defaultChromium, PdfBusy, PdfTimeout, PdfTooLarge, PdfUnavailable } from '../server/pdf.ts'
import { IN, marginsOf, PAPER_SIZES, type PageSetup } from '../src/editor/paper.ts'
import { api, connectDocument, DEV_PORTS, startServer, typeParagraph, type RunningServer } from './helpers.ts'
import { blockMathJson, codeJson, docState, everyNodeJson, matrixLatex, pageMeta, paragraphsJson, PNG_DATA_URL, type Meta } from './pdf-fixtures.ts'

const CHROMIUM = process.env.WRITE_PDF_CHROMIUM || defaultChromium()
const POPPLER = Boolean(Bun.which('pdfinfo') && Bun.which('pdftotext'))
if (!CHROMIUM) console.warn('[pdf.test] No Chromium headless shell: the PDF rendering tests are skipped.')

const ALICE = 'alice@x.com'
const BOB = 'bob@x.com'
const CAROL = 'carol@x.com'
const MALLORY = 'mallory@x.com'

const cookie = (email: string) => ({ cookie: `write-dev-user=${encodeURIComponent(email)}` })

type Seeded = { id: string; state: Uint8Array; title?: string; trashed?: boolean }

/** Writes an index (version 2) owned by alice and shared with bob and carol, and each document's state. */
async function seedDocs(dataDir: string, docs: Seeded[]) {
  const now = Date.now()
  const index = {
    version: 2,
    docs: Object.fromEntries(
      docs.map(({ id, title = '', trashed }) => [
        id,
        {
          title,
          preview: '',
          words: 0,
          createdAt: now,
          updatedAt: now,
          owner: ALICE,
          shares: { [BOB]: 'editor', [CAROL]: 'viewer' },
          ...(trashed ? { trashedAt: now } : {}),
        },
      ]),
    ),
    deleted: {},
  }
  await writeFile(join(dataDir, 'index.json'), JSON.stringify(index))
  for (const { id, state } of docs) await writeFile(join(dataDir, docFileName(id)), state)
}

async function getPdf(server: RunningServer, id: string, email = ALICE) {
  const response = await fetch(`${server.url}/api/docs/${encodeURIComponent(id)}/pdf`, { headers: cookie(email) })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { response, bytes, json: () => JSON.parse(bytes.toString('utf8')) as Record<string, unknown> }
}

const tmp = () => mkdtemp(join(process.env.WRITE_TEST_TMP ?? tmpdir(), 'test-pdf-'))

async function pdfTool(tool: 'pdfinfo' | 'pdftotext', pdf: Buffer, args: string[] = []) {
  const dir = await tmp()
  try {
    const file = join(dir, 'doc.pdf')
    await writeFile(file, pdf)
    const run = spawnSync(tool, [...args, file, ...(tool === 'pdftotext' ? ['-'] : [])], { encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`${tool} failed: ${run.stderr}`)
    return run.stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Page count, page size in pt, and every word with its box (pdftotext -bbox). */
async function layout(pdf: Buffer) {
  const info = await pdfTool('pdfinfo', pdf)
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1])
  const [, width, height] = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info) ?? []
  const bbox = await pdfTool('pdftotext', pdf, ['-bbox'])
  const words = [...bbox.matchAll(/xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({
    x0: Number(m[1]),
    y0: Number(m[2]),
    x1: Number(m[3]),
    y1: Number(m[4]),
    text: m[5],
  }))
  return { pages, width: Number(width), height: Number(height), words }
}

const PT = 72 / IN

/** An HTML table that takes Chromium about 1 s (2000 rows) to 3.5 s (5000 rows) to print. */
const bigTable = (rows: number) =>
  `<table>${Array.from({ length: rows }, (_, i) => `<tr>${Array.from({ length: 8 }, (_, j) => `<td>r${i}c${j}</td>`).join('')}</tr>`).join('')}</table>`

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether process `pid` is gone within `ms`. */
async function gone(pid: number, ms: number) {
  const deadline = Date.now() + ms
  while (alive(pid) && Date.now() < deadline) await Bun.sleep(100)
  return !alive(pid)
}

/** Chromium headless shell browser processes started by process `parent` (their renderers are their own children). */
function browsersOf(parent: number) {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }).stdout
  return ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && Number(m[2]) === parent && m[3].includes('chrome-headless-shell'))
    .map((m) => Number(m[1]))
}

/** The page's body, without its stylesheets. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body>'))

/** The page size in pt for a page setup. */
function expectedSize(setup: PageSetup) {
  const paper = PAPER_SIZES[setup.size]
  const [w, h] = [paper.width * PT, paper.height * PT]
  return setup.orientation === 'landscape' ? [h, w] : [w, h]
}

// ---------- The HTML page ----------

describe('PDF page (HTML)', () => {
  test('every node renders statically, with nothing that loads or runs', () => {
    const { html, title, setup } = documentPage(docState(everyNodeJson('http://127.0.0.1:9/linked.png'), { title: 'All <nodes>' }))
    expect(title).toBe('All <nodes>')
    expect(setup).toEqual({ size: 'a4', orientation: 'portrait', margins: 'normal' })
    expect(html).toContain('<title>All &lt;nodes&gt;</title>')
    // Math by KaTeX, code by lowlight, the emoji as a character, callout icon, task boxes.
    expect(html).toContain('class="katex"')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).toContain('✨')
    expect(html).toContain('<span class="callout-icon">⚠️</span>')
    expect(html).toContain('class="task-box"')
    // Header rows repeat on every page; resized columns become proportions.
    expect(html).toMatch(/<thead><tr><th[^>]*><p>Name<\/p>/)
    expect(html).toContain('<col style="width: 25.000%">')
    // Embedded images stay; linked ones and videos become placeholders with their URL.
    expect(html).toContain(`src="${PNG_DATA_URL}"`)
    expect(html).toContain('http://127.0.0.1:9/linked.png</div>')
    expect(html).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ</div>')
    expect(html).not.toMatch(/<(iframe|script|input)\b/)
    expect(html).not.toMatch(/src="(?!data:)/)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://example.com/"')
    // Page setup: size and margins, then the page numbers in a rule of their own.
    expect(html).toContain('@page { size: 210mm 297mm; margin: 1in 1in 1in 1in; }')
    expect(html).toContain('@page { @bottom-center { content: "Page " counter(page) " of " counter(pages);')
  })

  test('an empty or unknown document is an empty page', () => {
    expect(documentPage(null).html).toContain('<main class="tiptap"></main>')
  })

  test('the welcome document image from public/ is inlined', () => {
    const { html } = documentPage(docState({ type: 'doc', content: [{ type: 'image', attrs: { src: '/sample.svg' } }] }))
    expect(html).toContain('src="data:image/svg+xml;base64,')
    const outside = documentPage(docState({ type: 'doc', content: [{ type: 'image', attrs: { src: '/../package.json' } }] }))
    expect(outside.html).not.toContain('src=')
  })

  test('inline styles keep only plain typographic values', () => {
    expect(cleanStyle('color: #7c3aed; font-family: Georgia, serif')).toBe('color: #7c3aed; font-family: Georgia, serif')
    expect(cleanStyle('color: rgb(1, 2, 3)')).toBe('color: rgb(1, 2, 3)')
    expect(cleanStyle('background-color: url(http://x/)')).toBe('')
    expect(cleanStyle('background-image: url(x); position: fixed; color: red')).toBe('color: red')
    expect(cleanStyle('font-family: "a\\"; color: image-set(x)')).toBe('')
  })

  test('the file name is the title, without path or quote characters', () => {
    expect(pdfDisposition('Plan: Q3/Q4 "final"')).toBe(
      `attachment; filename="Plan- Q3-Q4 -final.pdf"; filename*=UTF-8''Plan-%20Q3-Q4%20-final.pdf`,
    )
    expect(pdfDisposition('')).toContain('filename="Untitled document.pdf"')
    expect(pdfDisposition('Résumé\r\nX-Evil: 1')).toBe(
      `attachment; filename="R_sum_-X-Evil- 1.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9-X-Evil-%201.pdf`,
    )
    // RFC 5987: ' ( ) * ! are percent-encoded too.
    expect(pdfDisposition("it's (1)!")).toBe(`attachment; filename="it's (1)!.pdf"; filename*=UTF-8''it%27s%20%281%29%21.pdf`)
  })

  test('a long title is cut by whole characters, and a lone surrogate becomes U+FFFD', () => {
    // 119 letters and an emoji: the 120th character is the whole emoji, never half of it.
    const emoji = pdfDisposition(`${'a'.repeat(119)}😀 and more`)
    expect(emoji).toContain(`filename*=UTF-8''${'a'.repeat(119)}%F0%9F%98%80.pdf`)
    expect(emoji).toContain(`filename="${'a'.repeat(119)}_.pdf"`)
    expect(pdfDisposition('x\uD800y')).toContain(`filename*=UTF-8''x%EF%BF%BDy.pdf`)
    expect(pdfDisposition('\uDC00')).toContain(`filename*=UTF-8''%EF%BF%BD.pdf`)
  })

  test('closed toggles keep only their summary; nested lists stay nested', () => {
    const html = bodyOf(documentPage(docState(everyNodeJson('http://127.0.0.1:9/linked.png'))).html)
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Closed summary<\/summary>/)
    expect(html).not.toMatch(/<details[^>]*open[^>]*><summary[^>]*>Closed summary/)
    expect(html).toMatch(/<details[^>]*open[^>]*><summary[^>]*>Toggle summary/)
    expect(html).toMatch(/<li><p>Bullet<\/p><ul><li><p>Nested bullet<\/p><\/li><\/ul><\/li>/)
    expect(html).toMatch(/<ol start="3"><li><p>Numbered<\/p><ol><li><p>Nested number<\/p>/)
    expect(html).toContain('Nested task')
  })

  test('code: no guessing for an unknown language, and large blocks print plain', () => {
    const highlighted = (json: Parameters<typeof docState>[0]) => bodyOf(documentPage(docState(json)).html).includes('class="hljs-')
    expect(highlighted(codeJson(2, 'zzz'))).toBe(false)
    expect(highlighted(codeJson(2, 'ts'))).toBe(true)
    expect(highlighted(codeJson(MAX_HIGHLIGHT_CHARS / 1000 + 10, 'ts'))).toBe(false)
  })

  test('math: deep nesting, huge and unparsable formulas never fail the export', () => {
    const deep = `${'{'.repeat(5000)}x${'}'.repeat(5000)}`
    const huge = matrixLatex(300)
    const page = documentPage(docState(blockMathJson(deep, huge, 'x^{', 'e = mc^2'))).html
    const html = bodyOf(page)
    // KaTeX overflows its stack on `deep`: the source prints instead, and so does `huge` (over the cap).
    expect(html).toContain(`<code class="math-source">${deep}</code>`)
    expect(huge.length).toBeGreaterThan(MAX_FORMULA_CHARS)
    expect(html).toContain('<code class="math-source">\\begin{matrix}x&amp;x')
    // A parse error is shown by KaTeX itself (in red), and a good formula renders.
    expect(html).toContain('katex-error')
    expect(html).toContain('<span class="katex">')
    expect(html).toContain('mathnormal">m</span>')
    // Nothing like KaTeX's 80-fold output for the matrix (14 MB): the sources are printed as they are.
    expect(html.length).toBeLessThan(3 * (huge.length + deep.length))
  })
})

// ---------- The renderer ----------

describe.skipIf(!CHROMIUM)('PDF renderer', () => {
  const settings = { chromium: CHROMIUM, maxConcurrent: 2, maxQueue: 8, timeoutMs: 30_000, maxBytes: 1e8 }

  test('no request leaves the page, whatever the HTML asks for', async () => {
    let hits = 0
    const target = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => (hits++, new Response('x')) })
    const url = `http://127.0.0.1:${target.port}`
    const renderer = createPdfRenderer(settings)
    try {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="${url}/a.css">
        <style>@import url(${url}/b.css); body { background: url(${url}/c.png) } @font-face { font-family: X; src: url(${url}/d.woff2) }</style></head>
        <body style="font-family: X"><img src="${url}/e.png"><iframe src="${url}/f"></iframe><script src="${url}/g.js"></script>
        <script>fetch('${url}/h')</script><object data="${url}/i"></object><video src="${url}/j"></video>text</body></html>`
      const pdf = await renderer.render(html)
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
      expect(hits).toBe(0)
    } finally {
      await renderer.close()
      void target.stop(true)
    }
  }, 60_000)

  test('more exports than slots and queue are refused, the rest wait their turn', async () => {
    const renderer = createPdfRenderer({ ...settings, maxConcurrent: 1, maxQueue: 1 })
    try {
      const results = await Promise.allSettled([1, 2, 3, 4].map((n) => renderer.render(`<p>${n}</p>`)))
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'rejected'])
      for (const result of results.slice(2)) expect((result as PromiseRejectedResult).reason).toBeInstanceOf(PdfBusy)
    } finally {
      await renderer.close()
    }
  }, 60_000)

  test('exportDocument builds the page in a worker and prints it; too large is PdfTooLarge', async () => {
    const renderer = createPdfRenderer({ ...settings, maxBytes: 60_000 })
    try {
      const { pdf, title } = await renderer.exportDocument(docState(everyNodeJson('http://127.0.0.1:9/x.png'), { title: 'Every node' }))
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
      expect(title).toBe('Every node')
      await expect(renderer.exportDocument(docState(paragraphsJson(400)))).rejects.toBeInstanceOf(PdfTooLarge)
    } finally {
      await renderer.close()
    }
  }, 60_000)

  test('a print that runs out of time is stopped, and the same renderer prints the next one', async () => {
    const renderer = createPdfRenderer({ ...settings, timeoutMs: 1500 })
    try {
      await renderer.render('<p>warm up</p>')
      const started = Date.now()
      // About 3.5 s to print: the deadline lands in page.pdf().
      await expect(renderer.render(bigTable(5000))).rejects.toBeInstanceOf(PdfTimeout)
      expect(Date.now() - started).toBeLessThan(2500)
      expect((await renderer.render('<p>next</p>')).subarray(0, 4).toString()).toBe('%PDF')
    } finally {
      await renderer.close()
    }
  }, 60_000)

  test('a browser that stops responding (SIGSTOP) is killed, and the next export starts a new one', async () => {
    const renderer = createPdfRenderer({ ...settings, timeoutMs: 3000 })
    try {
      await renderer.render('<p>warm up</p>')
      const stopped = renderer.browserPid()
      expect(stopped).toBeGreaterThan(0)
      process.kill(stopped as number, 'SIGSTOP')
      await expect(renderer.render('<p>hangs</p>')).rejects.toBeInstanceOf(PdfTimeout)
      expect((await renderer.render('<p>after</p>')).subarray(0, 4).toString()).toBe('%PDF')
      expect(renderer.browserPid()).not.toBe(stopped)
      expect(await gone(stopped as number, 10_000)).toBe(true)
    } finally {
      await renderer.close()
    }
  }, 60_000)

  test('close() refuses waiting exports, lets running ones finish, and leaves no Chromium behind', async () => {
    const renderer = createPdfRenderer({ ...settings, maxConcurrent: 1, maxQueue: 5 })
    await renderer.render('<p>warm up</p>')
    const pid = renderer.browserPid() as number
    const jobs = [renderer.render(bigTable(1000)), renderer.render('<p>waits</p>'), renderer.render('<p>waits too</p>')]
    // The first one is printing by now; the other two wait for its slot.
    await Bun.sleep(300)
    const closing = renderer.close()
    const results = await Promise.allSettled(jobs)
    await closing
    expect(results[0].status).toBe('fulfilled')
    for (const result of results.slice(1)) expect((result as PromiseRejectedResult).reason).toBeInstanceOf(PdfUnavailable)
    await expect(renderer.render('<p>after close</p>')).rejects.toBeInstanceOf(PdfUnavailable)
    expect(await gone(pid, 5000)).toBe(true)
    expect(browsersOf(process.pid)).toEqual([])
  }, 60_000)

  test.skipIf(!POPPLER)('a display formula wider than the page wraps instead of being cut off', async () => {
    const renderer = createPdfRenderer(settings)
    try {
      const wide = `${Array.from({ length: 30 }, (_, i) => `a_{${i + 1}}`).join(' + ')} = \\text{Wide end}`
      const { pdf } = await renderer.exportDocument(docState(blockMathJson(wide)))
      const { width, words } = await layout(pdf)
      const text = await pdfTool('pdftotext', pdf)
      expect(text).toContain('Wide end')
      expect(text).toContain('After the math')
      // Everything inside the right margin (1 in = 72 pt).
      expect(Math.max(...words.map((w) => w.x1))).toBeLessThanOrEqual(width - 72 + 0.5)
    } finally {
      await renderer.close()
    }
  }, 60_000)
})

// ---------- The endpoint ----------

const SETUPS: PageSetup[] = [
  { size: 'a4', orientation: 'portrait', margins: 'normal' },
  { size: 'letter', orientation: 'landscape', margins: 'narrow' },
  { size: 'a5', orientation: 'portrait', margins: 'wide' },
  { size: 'legal', orientation: 'portrait', margins: 'narrow' },
]
const setupId = (setup: PageSetup) => `doc-${setup.size}-${setup.orientation}-${setup.margins}`

describe.skipIf(!CHROMIUM)('GET /api/docs/:id/pdf', () => {
  let server: RunningServer
  let linked: ReturnType<typeof Bun.serve>
  let linkedHits = 0
  beforeAll(async () => {
    linked = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => (linkedHits++, new Response('x')) })
    const docs: Seeded[] = [
      { id: 'plan', title: 'Plan: Q3/Q4', state: docState(paragraphsJson(3), { title: 'Plan: Q3/Q4' }) },
      { id: 'every', title: 'Every node', state: docState(everyNodeJson(`http://127.0.0.1:${linked.port}/image.png`), { title: 'Every node' }) },
      { id: 'binned', title: 'Binned', state: docState(paragraphsJson(1)), trashed: true },
      ...SETUPS.map((setup) => ({ id: setupId(setup), state: docState(paragraphsJson(30), pageMeta(setup) as Meta) })),
    ]
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: { WRITE_PDF_CHROMIUM: CHROMIUM as string },
      seed: (dir) => seedDocs(dir, docs),
    })
  }, 30_000)
  afterAll(async () => {
    await server?.stop()
    void linked?.stop(true)
  })

  test('owner, editor and viewer get the PDF as an attachment named after the title', async () => {
    for (const email of [ALICE, BOB, CAROL]) {
      const { response, bytes } = await getPdf(server, 'plan', email)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/pdf')
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="Plan- Q3-Q4.pdf"; filename*=UTF-8''Plan-%20Q3-Q4.pdf`,
      )
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    }
    const exports = server.output().match(/"audit":"export"[^\n]*"doc":"plan"/g) ?? []
    expect(exports).toHaveLength(3)
    expect(server.output()).toContain(`"audit":"export","at":`)
    expect(server.output()).toMatch(new RegExp(`"audit":"export".*"actor":"${CAROL}".*"format":"pdf"`))
  }, 60_000)

  test('a stranger, a trashed document and an unknown one are 404', async () => {
    for (const [id, email] of [
      ['plan', MALLORY],
      ['binned', ALICE],
      ['binned', CAROL],
      ['nope', ALICE],
    ]) {
      const { response, json } = await getPdf(server, id, email)
      expect(response.status).toBe(404)
      expect(json()).toEqual({ error: 'not found' })
    }
  })

  test('every node type renders, and the linked image is never fetched', async () => {
    const { response, bytes } = await getPdf(server, 'every')
    expect(response.status).toBe(200)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    expect(linkedHits).toBe(0)
    if (!POPPLER) return
    const text = await pdfTool('pdftotext', bytes)
    for (const expected of ['Every node', 'Ada Lovelace', 'Done task', 'Merged', 'Wide cell', 'greeting', 'A warning callout', 'Toggle content']) {
      expect(text).toContain(expected)
    }
    expect(text).toContain(`http://127.0.0.1:${linked.port}/image.png`)
    expect(text).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  }, 60_000)

  test.skipIf(!POPPLER)('paper size, margins and "Page N of M" follow the page setup', async () => {
    for (const setup of SETUPS) {
      const { response, bytes } = await getPdf(server, setupId(setup))
      expect(response.status).toBe(200)
      const { pages, width, height, words } = await layout(bytes)
      const [expectedWidth, expectedHeight] = expectedSize(setup)
      expect(Math.abs(width - expectedWidth)).toBeLessThan(2)
      expect(Math.abs(height - expectedHeight)).toBeLessThan(2)
      expect(pages).toBeGreaterThan(1)

      const [top, right, bottom, left] = marginsOf(setup).map((m) => m * PT)
      // The footer sits in the bottom margin; everything else inside the margins.
      const footerTop = height - bottom
      const body = words.filter((word) => word.y0 < footerTop)
      const footer = words.filter((word) => word.y0 >= footerTop)
      expect(Math.min(...body.map((w) => w.x0))).toBeCloseTo(left, 0)
      expect(Math.max(...body.map((w) => w.x1))).toBeLessThanOrEqual(width - right + 1.5)
      // The first line's glyph box starts a little above the line box's top.
      expect(Math.abs(Math.min(...body.map((w) => w.y0)) - top)).toBeLessThan(3)
      expect(Math.max(...body.map((w) => w.y1))).toBeLessThanOrEqual(height - bottom + 0.5)

      const footerText = footer.map((w) => w.text).join(' ')
      expect(footerText).toContain(`Page 1 of ${pages}`)
      expect(footerText).toContain(`Page ${pages} of ${pages}`)
      // Centred, and nothing else from the browser (date, URL, title) on the sheet.
      const first = footer.filter((w) => w.y0 === footer[0]?.y0)
      const centre = (Math.min(...first.map((w) => w.x0)) + Math.max(...first.map((w) => w.x1))) / 2
      expect(Math.abs(centre - width / 2)).toBeLessThan(2)
      expect(words.filter((w) => w.y0 < top - 3)).toEqual([])
      expect(footer.every((w) => /^(Page|of|\d+)$/.test(w.text))).toBe(true)
    }
  }, 120_000)

  test.skipIf(!POPPLER)('an open document is exported as it is now, before it is stored', async () => {
    const live = await connectDocument(`ws://127.0.0.1:${server.port}/collab`, 'plan', { ...cookie(BOB), origin: server.url })
    try {
      typeParagraph(live.doc, 'Typed just now by bob')
      await Bun.sleep(150)
      const { response, bytes } = await getPdf(server, 'plan', CAROL)
      expect(response.status).toBe(200)
      expect(await pdfTool('pdftotext', bytes)).toContain('Typed just now by bob')
    } finally {
      live.destroy()
    }
  }, 60_000)
})

describe.skipIf(!CHROMIUM)('PDF limits', () => {
  let server: RunningServer
  beforeAll(async () => {
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: {
        WRITE_PDF_CHROMIUM: CHROMIUM as string,
        WRITE_PDF_MAX_CONCURRENT: '1',
        WRITE_PDF_MAX_QUEUE: '0',
        WRITE_PDF_MAX_MB: '0.1',
      },
      seed: (dir) =>
        seedDocs(dir, [
          { id: 'small', state: docState(paragraphsJson(40)) },
          { id: 'huge', state: docState(paragraphsJson(400)) },
        ]),
    })
  }, 30_000)
  afterAll(() => server?.stop())

  test('a document over WRITE_PDF_MAX_MB is 413', async () => {
    const { response, json } = await getPdf(server, 'huge')
    expect(response.status).toBe(413)
    expect(json()).toEqual({ error: 'document too large for a PDF' })
  })

  test('exports beyond the concurrency and queue limits are 503 with Retry-After', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => getPdf(server, 'small')))
    const statuses = results.map((r) => r.response.status).sort()
    expect(statuses).toContain(200)
    expect(statuses).toContain(503)
    for (const busy of results.filter((r) => r.response.status === 503)) {
      expect(busy.json().error).toBe('busy')
      expect(busy.response.headers.get('retry-after')).toBe('5')
    }
    // Once the others are done, the next one goes through.
    expect((await getPdf(server, 'small')).response.status).toBe(200)
  }, 60_000)
})

describe.skipIf(!CHROMIUM)('Heavy exports', () => {
  let server: RunningServer
  beforeAll(async () => {
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: { WRITE_PDF_CHROMIUM: CHROMIUM as string, WRITE_PDF_TIMEOUT_SECONDS: '20' },
      seed: (dir) =>
        seedDocs(dir, [
          // The review's documents: 1 MB of code in an unknown language, and a 300×300 matrix.
          { id: 'code', state: docState(codeJson(1000, 'zzz')) },
          { id: 'matrix', state: docState(blockMathJson(matrixLatex(300))) },
          { id: 'plan', state: docState(paragraphsJson(3)) },
        ]),
    })
  }, 30_000)
  afterAll(() => server?.stop())

  test('the API and the collaboration server stay responsive while 12 heavy exports run', async () => {
    const live = await connectDocument(`ws://127.0.0.1:${server.port}/collab`, 'plan', { ...cookie(BOB), origin: server.url })
    try {
      const exports = Promise.all(Array.from({ length: 12 }, (_, i) => getPdf(server, i % 3 === 2 ? 'matrix' : 'code', CAROL)))
      let done = false
      void exports.finally(() => (done = true))
      const latencies: number[] = []
      const syncs: number[] = []
      for (let i = 0; !done; i++) {
        const started = performance.now()
        await fetch(`${server.url}/api/docs`, { headers: cookie(CAROL) })
        latencies.push(performance.now() - started)
        if (i % 5 === 0) {
          // A collaborator's edit is confirmed by the server meanwhile.
          const typed = performance.now()
          typeParagraph(live.doc, `typed while exporting ${i}`)
          while (live.provider.unsyncedChanges > 0 && performance.now() - typed < 5000) await Bun.sleep(5)
          syncs.push(performance.now() - typed)
        }
        await Bun.sleep(50)
      }
      const results = await exports
      const statuses = results.map((r) => r.response.status)
      // Each either succeeds or fails cleanly: busy (2 running + 8 waiting), or out of time.
      for (const r of results.filter((r) => r.response.status !== 200)) {
        expect(r.response.status).toBe(503)
        expect(['busy', 'timed out']).toContain(r.json().error as string)
      }
      expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(2)
      expect(latencies.length).toBeGreaterThan(10)
      console.log(
        `[pdf.test] 12 heavy exports: ${statuses.join(',')}; /api/docs max ${Math.max(...latencies).toFixed(0)} ms over ` +
          `${latencies.length} requests; a collaborator's edit confirmed within ${Math.max(...syncs).toFixed(0)} ms`,
      )
      expect(Math.max(...latencies)).toBeLessThan(300)
      expect(Math.max(...syncs)).toBeLessThan(500)
    } finally {
      live.destroy()
    }
  }, 90_000)

  test('a Vite restart during exports leaves one browser, not two', async () => {
    // Vite drops the old server's open connections when it restarts, so some requests just fail.
    expect((await fetch(`${server.url}/api/me`)).status).toBe(200)
    // New connections, not ones the previous test left open.
    const pending = Array.from({ length: 4 }, () =>
      fetch(`${server.url}/api/docs/code/pdf`, { headers: { ...cookie(CAROL), connection: 'close' } }).then(
        async (response) => (await response.arrayBuffer(), response.status),
        (error: Error) => error.message.split(':')[0],
      ),
    )
    await Bun.sleep(800)
    const restarts = server.output().split('server restarted').length
    const now = new Date()
    await utimes(join(server.root, 'vite.config.ts'), now, now)
    const deadline = Date.now() + 20_000
    while (server.output().split('server restarted').length === restarts && Date.now() < deadline) await Bun.sleep(100)
    const results = await Promise.all(pending)
    console.log(`[pdf.test] exports across a restart: ${results.join(', ')}`)
    for (const result of results) if (typeof result === 'number') expect([200, 503]).toContain(result)
    expect((await getPdf(server, 'plan', CAROL)).response.status).toBe(200)
    // Give the old runtime's browser its grace period to close.
    const settle = Date.now() + 15_000
    while (browsersOf(server.child.pid as number).length > 1 && Date.now() < settle) await Bun.sleep(200)
    expect(browsersOf(server.child.pid as number)).toHaveLength(1)
  }, 90_000)

  test('stopping the server leaves no Chromium behind', async () => {
    const browsers = browsersOf(server.child.pid as number)
    expect(browsers.length).toBeGreaterThan(0)
    await server.stop()
    for (const pid of browsers) expect(await gone(pid, 10_000)).toBe(true)
  }, 30_000)
})

describe('Without Chromium', () => {
  let server: RunningServer
  beforeAll(async () => {
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: { WRITE_PDF_CHROMIUM: '/nonexistent/chrome-headless-shell' },
      seed: (dir) => seedDocs(dir, [{ id: 'plan', state: docState(paragraphsJson(2)) }]),
    })
  }, 30_000)
  afterAll(() => server?.stop())

  test('the server starts with one warning, and PDF downloads are 503 with the reason', async () => {
    const warnings = server.output().match(/PDF download is off/g) ?? []
    expect(warnings).toHaveLength(1)
    expect(server.output()).toContain('no Chromium at /nonexistent/chrome-headless-shell (WRITE_PDF_CHROMIUM)')
    const { response, json } = await getPdf(server, 'plan')
    expect(response.status).toBe(503)
    // People are told it isn't set up; the path and how to install it stay in the server's log.
    expect(json()).toEqual({ error: 'pdf unavailable', message: expect.stringContaining('isn’t set up on this server') })
    expect(JSON.stringify(json())).not.toContain('/nonexistent')
    // Access is still checked first, and everything else works.
    expect((await getPdf(server, 'plan', MALLORY)).response.status).toBe(404)
    expect((await api(server, '/api/docs', { headers: cookie(ALICE) })).status).toBe(200)
  })
})
