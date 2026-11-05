import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDoc,
  deleteForever,
  displayTitle,
  docUrl,
  duplicateDoc,
  emptyTrash,
  listDocs,
  listTrash,
  probeSession,
  removeFromMyList,
  renameDoc,
  restoreOrConfirmOpen,
  trashDoc,
  type DocMeta,
  type TrashedDoc,
} from '../api'
import { AccountMenu } from '../components/AccountMenu'
import { Dropdown, MenuItem } from '../components/Dropdown'
import { SessionBanner } from '../components/SessionBanner'
import { ShareDialog } from '../components/ShareDialog'
import { ThemeToggle } from '../components/ThemeToggle'
import { readStorage, writeStorage } from '../editor/storage'
import { TEMPLATES, type Template } from '../editor/templates'
import { useMe } from '../session'
import { autoStartTour, setTourContext, startTour, toursFor } from '../tours'
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

/** Search covers the title and text, and for Shared with me also the owner's email. */
const matchesQuery = (doc: DocMeta, query: string) => {
  const q = query.trim().toLowerCase()
  const owner = doc.role === 'owner' ? '' : doc.owner
  return !q || `${displayTitle(doc)} ${doc.preview} ${owner}`.toLowerCase().includes(q)
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
  const me = useMe()
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
  const [sharing, setSharing] = useState<string | null>(null)
  const [toast, setToastState] = useState<Toast | null>(null)
  const setToast = (text: string, undo?: DocMeta) => setToastState({ text, undo })
  const searchRef = useRef<HTMLInputElement>(null)

  // Bumped to reload the lists now, e.g. after signing in again.
  const [reload, setReload] = useState(0)
  const reloadNow = useCallback(() => setReload((n) => n + 1), [])

  // Load now, then keep the lists fresh (other people edit, rename, create and delete documents too).
  useEffect(() => {
    let cancelled = false
    // The two lists load independently, so a failing Trash request can't blank the documents.
    const refresh = async () => {
      // Signed in as someone else since this page loaded (another tab switched user): show the
      // banner rather than that person's documents under this person's name.
      if ((await probeSession(me.email)) === 'other-user' || cancelled) return
      listDocs().then(
        (list) => {
          if (cancelled) return
          setDocs(list)
          setError(false)
        },
        () => !cancelled && setError(true),
      )
      listTrash().then(
        (trashed) => {
          if (cancelled) return
          setTrash(trashed.docs)
          setRetentionDays(trashed.retentionDays)
          // Arriving from a document's File → Move to trash: offer to undo it here.
          const doc = justTrashed && trashed.docs.find((d) => d.id === justTrashed)
          justTrashed = null
          if (doc) setToastState({ text: `Moved “${displayTitle(doc)}” to the trash.`, undo: doc })
        },
        () => undefined,
      )
    }
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
  }, [reload, me.email])

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

  useEffect(() => setTourContext({ role: null, mode: me.mode }), [me.mode])

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

  // One search and one sort for both sections.
  const [mine, shared] = useMemo(() => {
    const matching = (docs ?? []).filter((doc) => matchesQuery(doc, query)).sort((a, b) => {
      if (sort === 'title') return displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: 'base' })
      if (sort === 'created') return b.createdAt - a.createdAt
      return b.updatedAt - a.updatedAt
    })
    return [matching.filter((doc) => doc.role === 'owner'), matching.filter((doc) => doc.role !== 'owner')]
  }, [docs, query, sort])
  const hasShared = (docs ?? []).some((doc) => doc.role !== 'owner')

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

  // Only the owner can share it with them again, so ask first.
  const removeFromList = async (doc: DocMeta) => {
    if (!window.confirm(`Remove “${displayTitle(doc)}” from your list? You’ll lose access until ${doc.owner} shares it with you again.`)) return
    try {
      await removeFromMyList(doc.id, me.email)
      setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setToast(`Removed “${displayTitle(doc)}” from your list.`)
    } catch {
      setToast('Could not remove the document from your list.')
    }
  }

  const restore = async (doc: DocMeta, message = `Restored “${displayTitle(doc)}”.`) => {
    try {
      await restoreOrConfirmOpen(doc.id)
      setTrash((list) => list?.filter((d) => d.id !== doc.id) ?? list)
      setDocs(await listDocs())
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
    // Exactly the documents on screen: anything trashed since the last refresh stays.
    const ids = (trash ?? []).map((d) => d.id)
    if (!window.confirm(`Delete ${ids.length === 1 ? 'this document' : `all ${ids.length} documents`} in the trash forever? This can’t be undone.`)) return
    try {
      const { purged } = await emptyTrash(ids)
      const fresh = await listTrash()
      setTrash(fresh.docs)
      setToast(
        fresh.docs.length
          ? `Deleted ${purged} forever. ${fresh.docs.length} newly trashed ${fresh.docs.length === 1 ? 'document was' : 'documents were'} kept.`
          : 'Trash emptied.',
      )
    } catch {
      setToast('Could not empty the trash.')
    }
  }

  const renderDocs = (list: DocMeta[], tourFirst: boolean) => (
    <ul className={`docs ${view}`}>
      {list.map((doc, index) => (
        <DocItem
          key={doc.id}
          doc={doc}
          view={view}
          isFirst={tourFirst && index === 0}
          renaming={renaming === doc.id}
          onStartRename={() => setRenaming(doc.id)}
          onRename={(title) => void rename(doc, title)}
          onCancelRename={() => setRenaming(null)}
          onDuplicate={() => void duplicate(doc)}
          onShare={() => setSharing(doc.id)}
          onDelete={() => void moveToTrash(doc)}
          onRemoveFromList={() => void removeFromList(doc)}
        />
      ))}
    </ul>
  )

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
          <AccountMenu />
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
      <SessionBanner onSignedIn={reloadNow} />

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
            <h2 className="section-title">{query ? `Results for “${query}”` : 'Documents'}</h2>
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
          ) : query && mine.length === 0 && shared.length === 0 ? (
            <div className="empty">
              <p>No documents match “{query}”.</p>
            </div>
          ) : (
            <div className="doc-groups" data-tour="doc-list">
              {(!query || mine.length > 0) && (
                <section className="doc-group" aria-labelledby="mine-title">
                  <h3 id="mine-title" className="doc-group-title">
                    My documents {mine.length > 0 && <span className="count">{mine.length}</span>}
                  </h3>
                  {mine.length === 0 ? (
                    <div className="empty">
                      <p className="empty-title">No documents yet</p>
                      <p className="muted">Pick a template above to create your first one.</p>
                    </div>
                  ) : (
                    renderDocs(mine, true)
                  )}
                </section>
              )}
              {(!query || shared.length > 0) && (
                <section className="doc-group" aria-labelledby="shared-title" data-tour="shared">
                  <h3 id="shared-title" className="doc-group-title">
                    Shared with me {shared.length > 0 && <span className="count">{shared.length}</span>}
                  </h3>
                  {hasShared ? (
                    renderDocs(shared, mine.length === 0)
                  ) : (
                    <p className="muted small shared-empty">
                      Nothing yet. When someone shares a document with {me.email}, it appears here.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </main>
      )}

      {sharing && (
        <ShareDialog
          docId={sharing}
          onClose={() => setSharing(null)}
          onChange={(changed) => setDocs((list) => list?.map((d) => (d.id === changed.id ? { ...d, shares: changed.shares } : d)) ?? list)}
        />
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
  onShare: () => void
  onDelete: () => void
  onRemoveFromList: () => void
}

function DocItem(props: DocItemProps) {
  const { doc, view, isFirst, renaming, onStartRename, onRename, onCancelRename } = props
  const title = displayTitle(doc)
  const href = docUrl(doc.id)
  const edited = `Edited ${relativeTime(doc.updatedAt)}`
  const isOwner = doc.role === 'owner'
  const shareCount = Object.keys(doc.shares ?? {}).length

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

  // Shared with me: whose it is and what you may do. My documents: how many people it's shared with.
  const sharing = isOwner ? (
    shareCount > 0 && (
      <span className="doc-shared muted small" title={`Shared with ${shareCount} ${shareCount === 1 ? 'person' : 'people'}`}>
        <PeopleIcon /> {shareCount}
      </span>
    )
  ) : (
    <span className="doc-owner muted small" title={`Owner: ${doc.owner}`}>
      {doc.owner}
      {doc.role === 'viewer' ? ' · view only' : ''}
    </span>
  )

  const item = (label: string, run: () => void, danger = false) => (
    <MenuItem onSelect={run}>{danger ? <span className="danger-text">{label}</span> : label}</MenuItem>
  )

  // What the ⋮ menu offers follows your role on the document.
  const menu = (
    <Dropdown label="⋮" title={`Actions for ${title}`} align="end" className="doc-menu" tour={isFirst ? 'doc-actions' : undefined}>
      {(close) => {
        const then = (run: () => void) => () => {
          close()
          run()
        }
        return (
          <>
            {doc.role !== 'viewer' && item('Rename', then(onStartRename))}
            {item(isOwner ? 'Share…' : 'Who has access…', then(props.onShare))}
            {item('Make a copy', then(props.onDuplicate))}
            {item('Open in new tab', then(() => window.open(href, '_blank', 'noopener')))}
            <hr />
            {isOwner ? item('Move to trash', then(props.onDelete), true) : item('Remove from my list', then(props.onRemoveFromList), true)}
          </>
        )
      }}
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
          {isOwner ? <span className="doc-snippet muted small">{doc.preview || 'Empty document'}</span> : sharing}
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
          {!isOwner && sharing}
          <span className="doc-meta">
            <time className="muted small" dateTime={new Date(doc.updatedAt).toISOString()}>
              {edited}
            </time>
            {isOwner && sharing}
          </span>
        </div>
        {menu}
      </div>
    </li>
  )
}

function PeopleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}
