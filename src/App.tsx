import { Component, lazy, Suspense, type ReactNode } from 'react'
import './App.css'

// Each page is its own chunk: the library doesn't download the editor, and a document
// doesn't download the library.
const DocumentPage = lazy(() => import('./pages/DocumentPage').then((m) => ({ default: m.DocumentPage })))
const Library = lazy(() => import('./pages/Library').then((m) => ({ default: m.Library })))

/**
 * Tiny router: `?doc=<id>` opens a document, anything else shows the library.
 * Navigation between them is a full page load, which keeps each page's
 * collaboration session simple.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  const doc = params.get('doc')?.trim()
  return (
    <LoadErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        {doc ? <DocumentPage key={doc} name={doc} templateId={params.get('template')} /> : <Library />}
      </Suspense>
    </LoadErrorBoundary>
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
