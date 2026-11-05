import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright-core'
import type { PdfSettings } from './config.ts'

/**
 * Download as PDF, like Google Docs' File → Download → PDF: the page setup's paper and margins,
 * "Page N of M" from the page's own `@page` rules, and none of the date, URL or title a browser's
 * print dialog adds. An export takes a queue slot, builds the HTML page from the document's state
 * in a worker thread (server/pdf-worker.ts, server/pdf-html.ts), and prints it with headless
 * Chromium. Nothing heavy runs on the server's own thread, which also serves the collaboration
 * sockets and the API.
 *
 * - **Queue:** at most `maxConcurrent` exports run at once and `maxQueue` wait; more get `PdfBusy`
 *   (503). Each export has `timeoutMs` (30 s) in all, waiting included; then `PdfTimeout` (503):
 *   its build is stopped (the worker terminated) or its browser context closed.
 * - **Size:** a stored document over `maxBytes` is `PdfTooLarge` (413), and so is a page over
 *   `PAGE_FACTOR` times that.
 * - **Browser:** Playwright's Chromium headless shell, launched on first use and reused; with its
 *   own sandbox when the system allows it, else without (one warning). A crashed browser is
 *   launched again on the next export; one that stops responding (a timed-out page that won't
 *   close) is killed. Each export gets a fresh context with JavaScript off, and every request but
 *   `data:` URLs is aborted: the page is `setContent` with everything inlined.
 * - **Close:** waiting exports are refused, running ones get `SHUTDOWN_GRACE_MS` to finish, then
 *   the browser is closed (killed if it doesn't close) and the workers terminated.
 * - **No Chromium** (not installed, or `WRITE_PDF_CHROMIUM` wrong): exports get `PdfUnavailable`
 *   (503) and the server logs one warning at startup; everything else works.
 */

export class PdfUnavailable extends Error {
  override name = 'PdfUnavailable'
}

export class PdfBusy extends Error {
  override name = 'PdfBusy'
}

export class PdfTooLarge extends Error {
  override name = 'PdfTooLarge'
}

export class PdfTimeout extends Error {
  override name = 'PdfTimeout'
}

/** The page may be larger than the stored document (math, highlighting): up to this many times `maxBytes`. */
export const PAGE_FACTOR = 4
/** Plus the stylesheets every page carries (KaTeX's with its fonts is about 1 MB). */
const PAGE_ASSETS_BYTES = 2 * 1024 * 1024
/** How long a timed-out page gets to close before its browser is considered hung and killed. */
const CONTEXT_CLOSE_GRACE_MS = 3000
/** How long running exports get to finish when the server stops or restarts. */
const SHUTDOWN_GRACE_MS = 5000
/** How long the browser gets to close before it is killed. */
const BROWSER_CLOSE_GRACE_MS = 3000
/** Idle page builders are kept this long for the next export. */
const IDLE_WORKER_MS = 60_000
/** A page builder may use this much memory (a bigger build fails instead of taking the server down). */
const WORKER_HEAP_MB = 1024

const STOPPING = 'the server is stopping'
const WORKER_URL = new URL('./pdf-worker.ts', import.meta.url)
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
  /**
   * Builds the page from a document's Yjs state and prints it. Rejects with `PdfUnavailable`,
   * `PdfBusy`, `PdfTooLarge`, `PdfTimeout`, or an error for a failed build or print.
   */
  exportDocument: (state: Uint8Array | null) => Promise<{ pdf: Buffer; title: string }>
  /** Prints an HTML page as it is (tests), with the same queue, deadline and browser. */
  render: (html: string) => Promise<Buffer>
  /** The browser's process ID while one runs (tests and diagnostics). */
  browserPid: () => number | undefined
  close: () => Promise<void>
}

/** One export: what the deadline must stop. */
type Job = {
  timedOut: boolean
  /** Set while waiting for a slot: refuses the wait. */
  cancelWait?: (error: Error) => void
  /** Set while the page is being built. */
  worker?: Worker
  /** Set once a launched browser is printing it (from `newContext` on). */
  printing?: boolean
  /** Set while the page is being printed. */
  context?: BrowserContext
}

type Launched = { browser: Browser; pid?: number }

/** Whether `promise` settles within `ms`. */
const settlesWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref()),
  ])

/** The process (a child of this one) whose command line has `marker`. */
function findProcess(marker: string): number | undefined {
  const matches = (pid: number, ppid: number, args: string) => (ppid === process.pid && args.includes(marker) ? pid : undefined)
  try {
    // Linux: /proc, without running anything.
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue
      try {
        const args = readFileSync(`/proc/${name}/cmdline`, 'utf8')
        if (!args.includes(marker)) continue
        const ppid = Number(/^\d+ \(.*\) \S+ (\d+)/s.exec(readFileSync(`/proc/${name}/stat`, 'utf8'))?.[1])
        const pid = matches(Number(name), ppid, args)
        if (pid) return pid
      } catch {
        // gone meanwhile
      }
    }
    return undefined
  } catch {
    // no /proc (macOS): ask ps
  }
  try {
    for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      const pid = m ? matches(Number(m[1]), Number(m[2]), m[3]) : undefined
      if (pid) return pid
    }
  } catch {
    // no ps
  }
  return undefined
}

function killGroup(pid: number) {
  // Playwright starts the browser as a process group leader (`detached`): this also reaches its
  // renderer and GPU processes.
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL')
      return
    } catch {
      // already gone, or not a group
    }
  }
}

export function createPdfRenderer(settings: PdfSettings): PdfRenderer {
  const executablePath = settings.chromium ?? defaultChromium()
  let unavailable: string | undefined
  if (!executablePath) unavailable = `PDF download is off: Chromium headless shell is not installed. ${INSTALL_HINT}`
  else if (!isExecutable(executablePath)) {
    unavailable = `PDF download is off: no Chromium at ${executablePath}${settings.chromium ? ' (WRITE_PDF_CHROMIUM)' : ''}. ${INSTALL_HINT}`
  } else if (!process.versions.bun && !(process.features as { typescript?: unknown }).typescript) {
    // The page builder is a TypeScript worker: Bun runs it, and Node from 22.18 (type stripping).
    unavailable = `PDF download is off: Node ${process.version} can't run the page builder (server/pdf-worker.ts). Use Node 22.18 or later.`
  }
  if (unavailable) console.warn(`[write] ${unavailable}`)

  let closed = false

  // ---------- The browser ----------

  /** Chromium's own sandbox, until a launch shows the system doesn't allow it. */
  let sandbox = true
  let launching: Promise<Launched> | undefined
  let current: Launched | undefined

  async function launch(): Promise<Launched> {
    // A switch Chromium ignores, to find this browser's process (to kill it if it stops responding).
    const marker = `--write-pdf-renderer=${randomUUID()}`
    const options: LaunchOptions = {
      executablePath,
      headless: true,
      // Not the export's own timeout: a launch outlives the export that started it, for the next ones.
      timeout: 60_000,
      // /dev/shm is small or private under systemd and in containers; /tmp is the unit's own.
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--disable-extensions', marker],
    }
    let browser: Browser | undefined
    if (sandbox) {
      try {
        browser = await chromium.launch({ ...options, chromiumSandbox: true })
      } catch (error) {
        if (!/sandbox/i.test(String(error))) throw error
        sandbox = false
        console.warn(
          '[write] PDF export: Chromium\'s sandbox is not available here (it needs unprivileged user namespaces), so ' +
            'Chromium runs without it. The page it prints has no JavaScript and no network; see "Download as PDF: ' +
            'security" in README.md.',
        )
      }
    }
    browser ??= await chromium.launch({ ...options, chromiumSandbox: false })
    return { browser, pid: findProcess(marker) }
  }

  function getBrowser(): Promise<Launched> {
    if (closed) return Promise.reject(new PdfUnavailable(STOPPING))
    if (launching) return launching
    const attempt = launch()
    launching = attempt
    attempt.then(
      (launched) => {
        if (launching === attempt) current = launched
        launched.browser.on('disconnected', () => {
          if (launching === attempt) launching = undefined
          if (current === launched) current = undefined
        })
      },
      (error: unknown) => {
        if (launching === attempt) launching = undefined
        console.error('[write] starting Chromium for a PDF failed:', error)
      },
    )
    return attempt
  }

  /** Closes the browser (killing it if it doesn't close); the next export launches a new one. */
  async function dropBrowser(why?: string) {
    const attempt = launching
    launching = undefined
    const launched = await attempt?.catch(() => undefined)
    if (!launched) return
    if (current === launched) current = undefined
    if (why) console.warn(`[write] PDF export: Chromium ${why}; stopping it (the next export starts a new one).`)
    if (!(await settlesWithin(launched.browser.close(), BROWSER_CLOSE_GRACE_MS)) && launched.pid) killGroup(launched.pid)
  }

  // ---------- Page builders (worker threads) ----------

  const idle: { worker: Worker; timer: ReturnType<typeof setTimeout> }[] = []
  const workers = new Set<Worker>()

  function takeWorker(): Worker {
    const reused = idle.pop()
    if (reused) {
      clearTimeout(reused.timer)
      return reused.worker
    }
    const worker = new Worker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } })
    worker.unref()
    workers.add(worker)
    worker.once('exit', () => {
      workers.delete(worker)
      const at = idle.findIndex((entry) => entry.worker === worker)
      if (at >= 0) idle.splice(at, 1)
    })
    return worker
  }

  function returnWorker(worker: Worker) {
    if (closed || idle.length >= settings.maxConcurrent) {
      void worker.terminate()
      return
    }
    const timer = setTimeout(() => void worker.terminate(), IDLE_WORKER_MS)
    timer.unref()
    idle.push({ worker, timer })
  }

  function build(state: Uint8Array | null, job: Job): Promise<{ html: string; title: string }> {
    const worker = takeWorker()
    job.worker = worker
    return new Promise((resolve, reject) => {
      const done = () => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        job.worker = undefined
      }
      const onMessage = (message: { ok: true; html: string; title: string } | { ok: false; error: string }) => {
        done()
        returnWorker(worker)
        if (message.ok) resolve({ html: message.html, title: message.title })
        else reject(new Error(`building the PDF page failed: ${message.error}`))
      }
      const onError = (error: Error) => {
        done()
        void worker.terminate()
        reject(error)
      }
      const onExit = (code: number) => {
        done()
        reject(new Error(`the PDF page builder stopped (exit code ${code})`))
      }
      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      worker.postMessage({ state })
    })
  }

  // ---------- Printing ----------

  /** Timed-out prints in a row: two mean the browser is in trouble even if pages still close. */
  let timeoutsInARow = 0

  async function print(html: string, deadline: number, job: Job) {
    const remaining = () => Math.max(1, deadline - Date.now())
    const { browser } = await getBrowser()
    job.printing = true
    const context = await browser.newContext({
      javaScriptEnabled: false,
      offline: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
    })
    job.context = context
    try {
      if (job.timedOut) throw new PdfTimeout('timed out')
      // Nothing leaves the machine: only the page's own `data:` URLs (images, fonts) load.
      await context.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort('blockedbyclient')))
      const page = await context.newPage()
      page.setDefaultTimeout(remaining())
      await page.setContent(html, { waitUntil: 'load', timeout: remaining() })
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, tagged: true })
      timeoutsInARow = 0
      return pdf
    } finally {
      job.context = undefined
      await context.close().catch(() => undefined)
    }
  }

  // ---------- Queue and deadline ----------

  let active = 0
  const waiting: { grant: () => void; refuse: (error: Error) => void }[] = []

  function acquire(job: Job): Promise<void> {
    if (active < settings.maxConcurrent) {
      active++
      return Promise.resolve()
    }
    if (waiting.length >= settings.maxQueue) return Promise.reject(new PdfBusy('too many PDF exports at once'))
    // The slot is handed over by `release`, so `active` stays counted.
    return new Promise<void>((grant, refuse) => {
      const waiter = { grant, refuse }
      waiting.push(waiter)
      job.cancelWait = (error) => {
        const at = waiting.indexOf(waiter)
        if (at < 0) return
        waiting.splice(at, 1)
        refuse(error)
      }
    }).finally(() => (job.cancelWait = undefined))
  }

  function release() {
    const next = waiting.shift()
    if (next) next.grant()
    else active--
  }

  /** Stops whatever a timed-out export is doing. */
  async function abandon(job: Job) {
    job.cancelWait?.(new PdfTimeout('timed out waiting for a turn'))
    if (job.worker) void job.worker.terminate()
    if (!job.printing) return
    timeoutsInARow++
    // A page that won't close, or a browser that never even opened one (`newContext` hanging),
    // means the browser has stopped responding.
    const context = job.context
    const responsive = context ? await settlesWithin(context.close(), CONTEXT_CLOSE_GRACE_MS) : false
    if (!responsive) await dropBrowser('stopped responding')
    else if (timeoutsInARow >= 2) await dropBrowser(`timed out ${timeoutsInARow} times in a row`)
  }

  const inflight = new Set<Promise<unknown>>()

  function run<T>(work: (job: Job, deadline: number) => Promise<T>): Promise<T> {
    if (unavailable) return Promise.reject(new PdfUnavailable(unavailable))
    if (closed) return Promise.reject(new PdfUnavailable(STOPPING))
    const deadline = Date.now() + settings.timeoutMs
    const job: Job = { timedOut: false }
    const task = (async () => {
      await acquire(job)
      try {
        if (closed) throw new PdfUnavailable(STOPPING)
        if (job.timedOut) throw new PdfTimeout('timed out')
        return await work(job, deadline)
      } finally {
        release()
      }
    })()
    const settled = task.then(
      () => undefined,
      () => undefined,
    )
    inflight.add(settled)
    void settled.then(() => inflight.delete(settled))
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        job.timedOut = true
        reject(new PdfTimeout(`PDF export timed out after ${settings.timeoutMs} ms`))
        void abandon(job)
      }, settings.timeoutMs)
    })
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
  }

  return {
    unavailable,
    exportDocument(state) {
      if (state && state.byteLength > settings.maxBytes) return Promise.reject(new PdfTooLarge('document too large'))
      return run(async (job, deadline) => {
        const page = await build(state, job)
        if (Buffer.byteLength(page.html) > settings.maxBytes * PAGE_FACTOR + PAGE_ASSETS_BYTES) throw new PdfTooLarge('page too large')
        if (job.timedOut) throw new PdfTimeout('timed out')
        return { pdf: await print(page.html, deadline, job), title: page.title }
      })
    },
    render: (html) => run((job, deadline) => print(html, deadline, job)),
    browserPid: () => current?.pid,
    async close() {
      closed = true
      for (const waiter of waiting.splice(0)) waiter.refuse(new PdfUnavailable(STOPPING))
      await settlesWithin(Promise.all(inflight), SHUTDOWN_GRACE_MS)
      for (const worker of workers) void worker.terminate()
      await dropBrowser()
    },
  }
}
