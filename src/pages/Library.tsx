import { useEffect, useMemo, useRef, useState } from 'react'
import { createDoc, deleteDoc, displayTitle, docUrl, duplicateDoc, listDocs, renameDoc, type DocMeta } from '../api'
import { Dropdown, MenuItem } from '../components/Dropdown'
import { ThemeToggle } from '../components/ThemeToggle'
import { readStorage, writeStorage } from '../editor/storage'
import { TEMPLATES, type Template } from '../editor/templates'
import { autoStartTour, startTour, toursFor } from '../tours'
import './library.css'

type SortKey = 'updated' | 'created' | 'title'
type ViewMode = 'grid' | 'list'

const REFRESH_MS = 10_000

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "just now", "5 minutes ago", "yesterday", then a plain date. */
function relativeTime(timestamp: number, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86_400) return relativeFormat.format(Math.round(seconds / 86_400), 'day')
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function usePersisted<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const saved = readStorage(key)
    return allowed.includes(saved as T) ? (saved as T) : fallback
  })
  const update = (next: T) => {
    setValue(next)
    writeStorage(key, next)
  }
  return [value, update] as const
}

export function Library() {
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = usePersisted<SortKey>('write:library-sort', ['updated', 'created', 'title'], 'updated')
  const [view, setView] = usePersisted<ViewMode>('write:library-view', ['grid', 'list'], 'grid')
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Load now, then keep the list fresh (other people edit, rename and create documents too).
  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      listDocs().then(
        (list) => {
          if (cancelled) return
          setDocs(list)
          setError(false)
        },
        () => !cancelled && setError(true),
      )
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  useEffect(() => {
    document.title = 'Documents – Write'
  }, [])

  // `/` focuses search; the library tour opens on a first visit.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === '?') {
        event.preventDefault()
        startTour('library')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loaded = docs !== null
  useEffect(() => {
    if (!loaded) return
    return autoStartTour('library', 500)
  }, [loaded])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const visible = useMemo(() => {
    if (!docs) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? docs.filter((doc) => `${displayTitle(doc)} ${doc.preview}`.toLowerCase().includes(q))
      : docs
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' })
      if (sort === 'created') return b.createdAt - a.createdAt
      return b.updatedAt - a.updatedAt
    })
  }, [docs, query, sort])

  const startFromTemplate = async (template: Template) => {
    setBusy(template.id)
    try {
      const doc = await createDoc(template.title)
      window.location.assign(docUrl(doc.id, template.id))
    } catch {
      setBusy(null)
      setToast('Could not create the document. Is the server running?')
    }
  }

  const rename = async (doc: DocMeta, title: string) => {
    setRenaming(null)
    if (title.trim() === doc.title) return
    try {
      const updated = await renameDoc(doc.id, title)
      setDocs((list) => list?.map((d) => (d.id === doc.id ? updated : d)) ?? list)
    } catch {
      setToast('Rename failed.')
    }
  }

  const duplicate = async (doc: DocMeta) => {
    try {
      const copy = await duplicateDoc(doc.id)
      setDocs((list) => (list ? [copy, ...list] : list))
      setToast(`Created “${displayTitle(copy)}”.`)
    } catch {
      setToast('Copy failed.')
    }
  }

  const remove = async (doc: DocMeta) => {
    if (!window.confirm(`Delete “${displayTitle(doc)}” for everyone? This can’t be undone.`)) return
    try {
      await deleteDoc(doc.id)
      setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setToast(`Deleted “${displayTitle(doc)}”.`)
    } catch {
      setToast('Delete failed.')
    }
  }

  return (
    <div className="library">
      <header className="library-header">
        <a className="library-brand" href={window.location.pathname}>
          <span className="logo" aria-hidden>
            ✍️
          </span>
          <span className="brand-name">Write</span>
        </a>
        <label className="search" data-tour="search">
          <span className="search-icon" aria-hidden>
            ⌕
          </span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search documents"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                e.currentTarget.blur()
              }
            }}
          />
          <kbd aria-hidden>/</kbd>
        </label>
        <div className="header-actions">
          <ThemeToggle />
          <Dropdown label="?" title="Guided tours" tour="help" align="end" className="help">
            {(close) =>
              toursFor('library').map(([id, tour]) => (
                <MenuItem
                  key={id}
                  onSelect={() => {
                    close()
                    requestAnimationFrame(() => startTour(id))
                  }}
                >
                  <span className="tour-item">
                    <strong>{tour.title}</strong>
                    <span className="muted small">{tour.summary}</span>
                  </span>
                </MenuItem>
              ))
            }
          </Dropdown>
        </div>
      </header>

      <section className="templates-band" aria-labelledby="templates-title">
        <div className="library-inner">
          <h2 id="templates-title" className="section-title">
            Start a new document
          </h2>
          <div className="templates" data-tour="templates">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template"
                disabled={busy !== null}
                onClick={() => void startFromTemplate(template)}
              >
                <span className={`page-thumb${template.id === 'blank' ? ' blank' : ''}`} aria-hidden>
                  {template.id === 'blank' ? (
                    <span className="plus">＋</span>
                  ) : (
                    template.thumbnail.map((line, i) => (
                      <span key={i} className={i === 0 ? 'thumb-title' : 'thumb-line'}>
                        {line}
                      </span>
                    ))
                  )}
                  {busy === template.id && <span className="spinner thumb-spinner" />}
                </span>
                <span className="template-name">{template.name}</span>
                <span className="template-desc muted small">{template.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="library-inner docs-section">
        <div className="docs-toolbar">
          <h2 className="section-title">{query ? `Results for “${query}”` : 'Recent documents'}</h2>
          <div className="docs-controls">
            <label className="sort">
              <span className="visually-hidden">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort documents">
                <option value="updated">Last edited</option>
                <option value="created">Date created</option>
                <option value="title">Title</option>
              </select>
            </label>
            <div className="view-toggle" role="group" aria-label="Layout">
              <button
                type="button"
                aria-pressed={view === 'grid'}
                title="Grid view"
                onClick={() => setView('grid')}
              >
                ▦
              </button>
              <button
                type="button"
                aria-pressed={view === 'list'}
                title="List view"
                onClick={() => setView('list')}
              >
                ☰
              </button>
            </div>
          </div>
        </div>

        {error && docs === null ? (
          <p className="empty">Couldn’t reach the server. Is `bun dev` running?</p>
        ) : docs === null ? (
          <div className="loading inline" role="status">
            <span className="spinner" aria-hidden /> Loading documents…
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {query ? (
              <p>No documents match “{query}”.</p>
            ) : (
              <>
                <p className="empty-title">No documents yet</p>
                <p className="muted">Pick a template above to create your first one.</p>
              </>
            )}
          </div>
        ) : (
          <ul className={`docs ${view}`} data-tour="doc-list">
            {visible.map((doc, index) => (
              <DocItem
                key={doc.id}
                doc={doc}
                view={view}
                isFirst={index === 0}
                renaming={renaming === doc.id}
                onStartRename={() => setRenaming(doc.id)}
                onRename={(title) => void rename(doc, title)}
                onCancelRename={() => setRenaming(null)}
                onDuplicate={() => void duplicate(doc)}
                onDelete={() => void remove(doc)}
              />
            ))}
          </ul>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

type DocItemProps = {
  doc: DocMeta
  view: ViewMode
  isFirst: boolean
  renaming: boolean
  onStartRename: () => void
  onRename: (title: string) => void
  onCancelRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function DocItem({ doc, view, isFirst, renaming, onStartRename, onRename, onCancelRename, onDuplicate, onDelete }: DocItemProps) {
  const title = displayTitle(doc)
  const href = docUrl(doc.id)
  const edited = `Edited ${relativeTime(doc.updatedAt)}`

  const titleNode = renaming ? (
    <input
      className="rename-input"
      aria-label="New title"
      defaultValue={doc.title}
      placeholder="Untitled document"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onRename(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') onCancelRename()
      }}
    />
  ) : (
    <a className="doc-title" href={href} title={title}>
      {title}
    </a>
  )

  const menu = (
    <Dropdown label="⋮" title={`Actions for ${title}`} align="end" className="doc-menu" tour={isFirst ? 'doc-actions' : undefined}>
      {(close) => (
        <>
          <MenuItem
            onSelect={() => {
              close()
              onStartRename()
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close()
              onDuplicate()
            }}
          >
            Make a copy
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close()
              window.open(href, '_blank', 'noopener')
            }}
          >
            Open in new tab
          </MenuItem>
          <hr />
          <MenuItem
            onSelect={() => {
              close()
              onDelete()
            }}
          >
            <span className="danger-text">Delete</span>
          </MenuItem>
        </>
      )}
    </Dropdown>
  )

  if (view === 'list') {
    return (
      <li className="doc-row">
        <span className="doc-icon" aria-hidden>
          ▤
        </span>
        <div className="doc-row-main">
          {titleNode}
          <span className="doc-snippet muted small">{doc.preview || 'Empty document'}</span>
        </div>
        <span className="doc-words muted small">{doc.words.toLocaleString()} words</span>
        <time className="doc-time muted small" dateTime={new Date(doc.updatedAt).toISOString()}>
          {edited}
        </time>
        {menu}
      </li>
    )
  }

  return (
    <li className="doc-card">
      <a className="page-thumb doc-thumb" href={href} tabIndex={-1} aria-hidden>
        {doc.title && <span className="thumb-title">{doc.title}</span>}
        <span className="thumb-text">{doc.preview || ' '}</span>
      </a>
      <div className="doc-card-footer">
        <div className="doc-card-text">
          {titleNode}
          <time className="muted small" dateTime={new Date(doc.updatedAt).toISOString()}>
            {edited}
          </time>
        </div>
        {menu}
      </div>
    </li>
  )
}
