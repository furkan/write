/**
 * Download as PDF (`GET /api/docs/:id/pdf`), end to end in Dev mode (`vite` on 5180/1240), plus
 * the HTML builder and the renderer on their own. Needs Playwright's Chromium headless shell (or
 * `WRITE_PDF_CHROMIUM`); the poppler tools (`pdfinfo`, `pdftotext`) for the page geometry checks.
 *
 * alice owns the documents, bob is an editor, carol a viewer and mallory a stranger.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docFileName, pdfDisposition } from '../server/collab.ts'
import { cleanStyle, documentPage } from '../server/pdf-html.ts'
import { createPdfRenderer, defaultChromium, PdfBusy } from '../server/pdf.ts'
import { IN, MARGIN_PRESETS, PAPER_SIZES, type PageSetup } from '../src/editor/paper.ts'
import { api, connectDocument, DEV_PORTS, startServer, typeParagraph, type RunningServer } from './helpers.ts'
import { docState, everyNodeJson, pageMeta, paragraphsJson, PNG_DATA_URL, type Meta } from './pdf-fixtures.ts'

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

  test('an export that takes too long fails, and the next one works', async () => {
    const renderer = createPdfRenderer({ ...settings, timeoutMs: 1 })
    try {
      await expect(renderer.render('<p>slow</p>')).rejects.toThrow('timed out')
    } finally {
      await renderer.close()
    }
    const next = createPdfRenderer(settings)
    try {
      expect((await next.render('<p>fast</p>')).subarray(0, 4).toString()).toBe('%PDF')
    } finally {
      await next.close()
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

      const [top, right, bottom, left] = MARGIN_PRESETS[setup.margins].margins.map((m) => m * PT)
      // The footer sits in the bottom margin; everything else inside the margins.
      const footerTop = height - bottom
      const body = words.filter((word) => word.y0 < footerTop)
      const footer = words.filter((word) => word.y0 >= footerTop)
      expect(Math.min(...body.map((w) => w.x0))).toBeCloseTo(left, 0)
      expect(Math.max(...body.map((w) => w.x1))).toBeLessThanOrEqual(width - right + 0.5)
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
    expect(json()).toEqual({ error: 'pdf unavailable', message: expect.stringContaining('PDF download is off') })
    // Access is still checked first, and everything else works.
    expect((await getPdf(server, 'plan', MALLORY)).response.status).toBe(404)
    expect((await api(server, '/api/docs', { headers: cookie(ALICE) })).status).toBe(200)
  })
})
