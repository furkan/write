import { lazy, Suspense } from 'react'
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
    <Suspense fallback={<PageLoading />}>
      {doc ? <DocumentPage key={doc} name={doc} templateId={params.get('template')} /> : <Library />}
    </Suspense>
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
