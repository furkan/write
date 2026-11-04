import './App.css'
import { DocumentPage } from './pages/DocumentPage'
import { Library } from './pages/Library'

/**
 * Tiny router: `?doc=<id>` opens a document, anything else shows the library.
 * Navigation between them is a full page load, which keeps each page's
 * collaboration session simple.
 */
export default function App() {
  const params = new URLSearchParams(window.location.search)
  const doc = params.get('doc')?.trim()
  if (doc) return <DocumentPage key={doc} name={doc} templateId={params.get('template')} />
  return <Library />
}
