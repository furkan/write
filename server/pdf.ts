import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import type { PdfSettings } from './config.ts'

type Job = { context?: BrowserContext; timedOut?: boolean }

/**
 * Prints the PDF export's HTML page (server/pdf-html.ts) with headless Chromium, like Google Docs'
 * File → Download → PDF: the page setup's paper and margins, "Page N of M" from the page's own
 * `@page` rules, and none of the date, URL or title a browser's print dialog adds.
 *
 * - One browser (Playwright's Chromium headless shell), launched on the first export and reused;
 *   closed when the server stops. A crashed browser is launched again on the next export.
 * - Each export gets a fresh context with JavaScript off, and every request but `data:` URLs is
 *   aborted: the page is `setContent` with everything inlined, so it never needs the network.
 * - At most `maxConcurrent` exports print at once and `maxQueue` wait; more get `PdfBusy` (503).
 *   Each has `timeoutMs` (30 s) in all.
 * - Without the browser (not installed, or `WRITE_PDF_CHROMIUM` wrong), exports get
 *   `PdfUnavailable` (503) and the server logs one warning at startup; everything else works.
 */

export class PdfUnavailable extends Error {
  override name = 'PdfUnavailable'
}

export class PdfBusy extends Error {
  override name = 'PdfBusy'
}

const require = createRequire(import.meta.url)

/** Playwright's own install of the headless shell for this `playwright-core` (`playwright-core install chromium-headless-shell`). */
export function defaultChromium(): string | undefined {
  try {
    const browsers = JSON.parse(readFileSync(join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json'), 'utf8')) as {
      browsers: { name: string; revision: string }[]
    }
    const revision = browsers.browsers.find((browser) => browser.name === 'chromium-headless-shell')?.revision
    if (!revision) return undefined
    const cache =
      process.env.PLAYWRIGHT_BROWSERS_PATH ||
      (process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'))
    const dir = join(cache, `chromium_headless_shell-${revision}`)
    // e.g. chrome-headless-shell-linux64/chrome-headless-shell or chrome-headless-shell-mac-arm64/…
    for (const name of readdirSync(dir)) {
      if (name.startsWith('chrome-headless-shell')) return join(dir, name, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
    }
  } catch {
    // not installed
  }
  return undefined
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const INSTALL_HINT =
  'Install it with `./node_modules/.bin/playwright-core install chromium-headless-shell` (as the user that runs the server), ' +
  'or set WRITE_PDF_CHROMIUM to a Chromium headless shell.'

export type PdfRenderer = {
  /** Why exports are off, or undefined when the browser is there. */
  unavailable: string | undefined
  /** Prints an HTML page to a PDF. Rejects with `PdfUnavailable`, `PdfBusy` or a timeout. */
  render: (html: string) => Promise<Buffer>
  close: () => Promise<void>
}

export function createPdfRenderer(settings: PdfSettings): PdfRenderer {
  const executablePath = settings.chromium ?? defaultChromium()
  let unavailable: string | undefined
  if (!executablePath) unavailable = `PDF download is off: Chromium headless shell is not installed. ${INSTALL_HINT}`
  else if (!isExecutable(executablePath)) {
    unavailable = `PDF download is off: no Chromium at ${executablePath}${settings.chromium ? ' (WRITE_PDF_CHROMIUM)' : ''}. ${INSTALL_HINT}`
  }
  if (unavailable) console.warn(`[write] ${unavailable}`)

  let browser: Promise<Browser> | undefined
  let closed = false

  const getBrowser = () => {
    if (browser) return browser
    const launching = chromium.launch({
      executablePath,
      headless: true,
      // Not the export's own timeout: a launch outlives the export that started it, for the next ones.
      timeout: 60_000,
      // /dev/shm is small or private under systemd and in containers; /tmp is the unit's own.
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--disable-extensions'],
    })
    browser = launching
    launching.then(
      (launched) =>
        launched.on('disconnected', () => {
          if (browser === launching) browser = undefined
        }),
      (error: unknown) => {
        if (browser === launching) browser = undefined
        console.error('[write] starting Chromium for a PDF failed:', error)
      },
    )
    return launching
  }

  // A tiny semaphore: `active` prints at once, the rest wait in order.
  let active = 0
  const waiting: (() => void)[] = []
  const acquire = async () => {
    if (active < settings.maxConcurrent) {
      active++
      return
    }
    if (waiting.length >= settings.maxQueue) throw new PdfBusy('too many PDF exports at once')
    // The slot is handed over by `release`, so `active` stays counted.
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  /** One export. `job.context` lets the timeout close it, which ends whatever it is doing. */
  async function print(html: string, deadline: number, job: Job) {
    const remaining = () => Math.max(1, deadline - Date.now())
    const context = await (await getBrowser()).newContext({
      javaScriptEnabled: false,
      offline: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
    })
    job.context = context
    try {
      if (job.timedOut) throw new Error('timed out')
      // Nothing leaves the machine: only the page's own `data:` URLs (images, fonts) load.
      await context.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort('blockedbyclient')))
      const page = await context.newPage()
      page.setDefaultTimeout(remaining())
      await page.setContent(html, { waitUntil: 'load', timeout: remaining() })
      return await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        tagged: true,
      })
    } finally {
      await context.close().catch(() => undefined)
    }
  }

  return {
    unavailable,
    async render(html) {
      if (unavailable) throw new PdfUnavailable(unavailable)
      if (closed) throw new PdfUnavailable('the server is stopping')
      const deadline = Date.now() + settings.timeoutMs
      await acquire()
      const job: Job = {}
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            job.timedOut = true
            void job.context?.close().catch(() => undefined)
            reject(new Error(`PDF export timed out after ${settings.timeoutMs} ms`))
          }, Math.max(1, deadline - Date.now()))
        })
        return await Promise.race([print(html, deadline, job), timeout])
      } finally {
        clearTimeout(timer)
        release()
      }
    },
    async close() {
      closed = true
      const current = browser
      browser = undefined
      if (current) await current.then((b) => b.close()).catch(() => undefined)
    },
  }
}
