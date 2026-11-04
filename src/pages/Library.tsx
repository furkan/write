import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createDoc,
  deleteForever,
  displayTitle,
  docUrl,
  duplicateDoc,
  emptyTrash,
  listDocs,
  listTrash,
  renameDoc,
  restoreDoc,
  trashDoc,
  type DocMeta,
  type TrashedDoc,
} from '../api'
import { Dropdown, MenuItem } from '../components/Dropdown'
import { ThemeToggle } from '../components/ThemeToggle'
import { readStorage, writeStorage } from '../editor/storage'
import { TEMPLATES, type Template } from '../editor/templates'
import { autoStartTour, startTour, toursFor } from '../tours'
import './library.css'

type SortKey = 'updated' | 'created' | 'title'
type ViewMode = 'grid' | 'list'
type Section = 'docs' | 'trash'
/** `undo` offers to restore a document that was just moved to the trash. */
type Toast = { text: string; undo?: DocMeta }

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

/** "in 29 days", "tomorrow", "in 5 hours". */
function timeUntil(timestamp: number, now = Date.now()) {
  const hours = Math.max(0, (timestamp - now) / 3_600_000)
  if (hours < 24) return relativeFormat.format(Math.max(1, Math.ceil(hours)), 'hour')
  return relativeFormat.format(Math.ceil(hours / 24), 'day')
}

const matchesQuery = (doc: DocMeta, query: string) => {
  const q = query.trim().toLowerCase()
  return !q || `${displayTitle(doc)} ${doc.preview}`.toLowerCase().includes(q)
}

/** Reads and removes `?trashed=<id>` (set by a document's "Move to trash"). */
function takeTrashedParam() {
  const url = new URL(window.location.href)
  const id = url.searchParams.get('trashed')
  if (!id) return null
  url.searchParams.delete('trashed')
  window.history.replaceState(null, '', url)
  return id
}

// Read once per page load (navigation to the library is always a full load). Module scope
// rather than an effect, so React's development double-run of effects can't lose it.
let justTrashed = takeTrashedParam()

const sectionFromUrl = (): Section => (window.location.hash === '#trash' ? 'trash' : 'docs')

/** The library or the Trash, kept in the URL hash so Back and links work. */
function useSection() {
  const [section, setSection] = useState<Section>(sectionFromUrl)
  useEffect(() => {
    const sync = () => setSection(sectionFromUrl())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  const go = (next: Section) => {
    if (next === section) return
    const url = new URL(window.location.href)
    url.hash = next === 'trash' ? 'trash' : ''
    window.history.pushState(null, '', url.hash ? url : url.pathname + url.search)
    setSection(next)
    window.scrollTo({ top: 0 })
  }
  return [section, go] as const
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
  const [trash, setTrash] = useState<TrashedDoc[] | null>(null)
  const [retentionDays, setRetentionDays] = useState(30)
  const [section, goTo] = useSection()
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = usePersisted<SortKey>('write:library-sort', ['updated', 'created', 'title'], 'updated')
  const [view, setView] = usePersisted<ViewMode>('write:library-view', ['grid', 'list'], 'grid')
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [toast, setToastState] = useState<Toast | null>(null)
  const setToast = (text: string, undo?: DocMeta) => setToastState({ text, undo })
  const searchRef = useRef<HTMLInputElement>(null)

  // Load now, then keep the lists fresh (other people edit, rename, create and delete documents too).
  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      Promise.all([listDocs(), listTrash()]).then(
        ([list, trashed]) => {
          if (cancelled) return
          setDocs(list)
          setTrash(trashed.docs)
          setRetentionDays(trashed.retentionDays)
          setError(false)
          // Arriving from a document's File → Move to trash: offer to undo it here.
          const doc = justTrashed && trashed.docs.find((d) => d.id === justTrashed)
          justTrashed = null
          if (doc) setToastState({ text: `Moved “${displayTitle(doc)}” to the trash.`, undo: doc })
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
    document.title = section === 'trash' ? 'Trash – Write' : 'Documents – Write'
  }, [section])

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
    // Leave time to reach an "Undo" button.
    const timer = window.setTimeout(() => setToastState(null), toast.undo ? 8000 : 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const visible = useMemo(() => {
    if (!docs) return []
    return docs.filter((doc) => matchesQuery(doc, query)).sort((a, b) => {
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

  const restore = async (doc: DocMeta, message = `Restored “${displayTitle(doc)}”.`) => {
    try {
      const restored = await restoreDoc(doc.id)
      setTrash((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setDocs((list) => (list ? [restored, ...list.filter((d) => d.id !== doc.id)] : list))
      setToast(message)
    } catch {
      setToast('Restore failed. It may have been deleted forever.')
    }
  }

  // Reversible, so no confirmation: the toast offers "Undo".
  const moveToTrash = async (doc: DocMeta) => {
    try {
      await trashDoc(doc.id)
      setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setTrash((list) => (list ? [{ ...doc, trashedAt: Date.now(), purgeAt: Date.now() + retentionDays * 86_400_000 }, ...list] : list))
      setToast(`Moved “${displayTitle(doc)}” to the trash.`, doc)
    } catch {
      setToast('Could not move the document to the trash.')
    }
  }

  const removeForever = async (doc: TrashedDoc) => {
    if (!window.confirm(`Delete “${displayTitle(doc)}” forever? This can’t be undone.`)) return
    try {
      await deleteForever(doc.id)
      setTrash((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setToast(`Deleted “${displayTitle(doc)}” forever.`)
    } catch {
      setToast('Delete failed.')
    }
  }

  const empty = async () => {
    const count = trash?.length ?? 0
    if (!window.confirm(`Delete ${count === 1 ? 'this document' : `all ${count} documents`} in the trash forever? This can’t be undone.`)) return
    try {
      await emptyTrash()
      setTrash([])
      setToast('Trash emptied.')
    } catch {
      setToast('Could not empty the trash.')
    }
  }

  const trashCount = trash?.length ?? 0
  const visibleTrash = (trash ?? []).filter((doc) => matchesQuery(doc, query))

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

      {section === 'docs' && (
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
      )}

      {section === 'trash' ? (
        <main className="library-inner docs-section trash-section">
          <div className="docs-toolbar">
            <div className="trash-heading">
              <button type="button" className="back-button" onClick={() => goTo('docs')}>
                ← Documents
              </button>
              <h2 className="section-title">{query ? `Trash results for “${query}”` : 'Trash'}</h2>
            </div>
            <button
              type="button"
              className="secondary-button danger-text"
              disabled={trashCount === 0}
              onClick={() => void empty()}
            >
              Empty trash
            </button>
          </div>
          <p className="trash-note muted small">
            Documents in the trash are deleted forever after {retentionDays} days. Daily backups are kept on the server
            too.
          </p>
          {error && trash === null ? (
            <p className="empty">Couldn’t reach the server. Is `bun dev` running?</p>
          ) : trash === null ? (
            <div className="loading inline" role="status">
              <span className="spinner" aria-hidden /> Loading the trash…
            </div>
          ) : visibleTrash.length === 0 ? (
            <div className="empty">
              {query ? (
                <p>Nothing in the trash matches “{query}”.</p>
              ) : (
                <>
                  <p className="empty-title">The trash is empty</p>
                  <p className="muted">Documents you delete stay here for {retentionDays} days.</p>
                </>
              )}
            </div>
          ) : (
            <ul className="docs list trash-list">
              {visibleTrash.map((doc) => (
                <li key={doc.id} className="doc-row">
                  <span className="doc-icon" aria-hidden>
                    ▤
                  </span>
                  <div className="doc-row-main">
                    <span className="doc-title">{displayTitle(doc)}</span>
                    <span className="doc-snippet muted small">{doc.preview || 'Empty document'}</span>
                    <span className="trash-dates small">
                      <time dateTime={new Date(doc.trashedAt).toISOString()}>Trashed {relativeTime(doc.trashedAt)}</time>
                      {' · '}deleted forever {timeUntil(doc.purgeAt)}
                    </span>
                  </div>
                  <div className="trash-actions">
                    <button type="button" className="secondary-button" onClick={() => void restore(doc)}>
                      Restore
                    </button>
                    <button
                      type="button"
                      className="icon-danger-button"
                      title={`Delete “${displayTitle(doc)}” forever`}
                      aria-label={`Delete “${displayTitle(doc)}” forever`}
                      onClick={() => void removeForever(doc)}
                    >
                      Delete forever
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>
      ) : (
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
              <button type="button" className="trash-button" data-tour="trash" onClick={() => goTo('trash')}>
                <TrashIcon />
                Trash
                {trashCount > 0 && <span className="count">{trashCount}</span>}
              </button>
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
                  onDelete={() => void moveToTrash(doc)}
                />
              ))}
            </ul>
          )}
        </main>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const { undo } = toast
                setToastState(null)
                if (undo) void restore(undo, 'Moved back to your documents.')
              }}
            >
              Undo
            </button>
          )}
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
            <span className="danger-text">Move to trash</span>
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

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}
