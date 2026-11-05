import { Component, lazy, Suspense, use, type ReactNode } from 'react'
import { getMe, isSessionError, type Me } from './api'
import { BootError, SignedInAgain, SignIn } from './pages/SignIn'
import { MeContext } from './session'
import './App.css'

const params = new URLSearchParams(window.location.search)
const docParam = params.get('doc')?.trim()

// Each page is its own chunk: the library doesn't download the editor, and a document
// doesn't download the library. The current page's chunk starts loading right away, alongside
// `/api/me`, instead of after it.
const loadDocumentPage = () => import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage }))
const loadLibrary = () => import('./pages/Library').then((m) => ({ default: m.Library }))
const signedInTab = params.has('signed-in')
const preloadedDocument = docParam && !signedInTab ? loadDocumentPage() : null
const preloadedLibrary = !docParam && !signedInTab ? loadLibrary() : null
// A failed preload must not report an unhandled rejection; `lazy` sees the same failure.
preloadedDocument?.catch(() => undefined)
preloadedLibrary?.catch(() => undefined)
const DocumentPage = lazy(() => preloadedDocument ?? loadDocumentPage())
const Library = lazy(() => preloadedLibrary ?? loadLibrary())

type Boot = { ok: true; me: Me } | { ok: false; signedOut: boolean }

/** Who is signed in, loaded once per page load. */
const boot: Promise<Boot> = getMe().then(
  (me) => ({ ok: true, me }),
  (error: unknown) => ({ ok: false, signedOut: isSessionError(error) }),
)

/**
 * Tiny router: `?doc=<id>` opens a document, `?signed-in` is the tab "Sign in again" opens,
 * anything else shows the library. Navigation between them is a full page load, which keeps
 * each page's collaboration session simple.
 */
export default function App() {
  return (
    <LoadErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Root />
      </Suspense>
    </LoadErrorBoundary>
  )
}

function Root() {
  const result = use(boot)
  if (!result.ok) return result.signedOut ? <SignIn /> : <BootError />
  return (
    <MeContext value={result.me}>
      {signedInTab ? (
        <SignedInAgain />
      ) : docParam ? (
        <DocumentPage key={docParam} name={docParam} templateId={params.get('template')} />
      ) : (
        <Library />
      )}
    </MeContext>
  )
}

function PageLoading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      Loading…
    </div>
  )
}

/**
 * Pages load as separate files; if one can't be fetched (a dropped connection, or the app was
 * rebuilt since this tab opened), offer a reload instead of a blank page.
 */
class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="loading deleted" role="alert">
        <p className="deleted-title">Write couldn’t load.</p>
        <p className="muted">Check your connection, then reload the page.</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
