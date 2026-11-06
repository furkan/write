import { Ellipsis, UserPlus, Users } from 'lucide-react'
import { libraryUrl } from '../../api'
import { setTitle, type Session } from '../../editor/collab'
import { useDocTitle, type Presence } from '../../editor/hooks'
import { initialOf } from '../../identity'
import { accountAction, useMe } from '../../session'
import { startTour, toursFor } from '../../tours'
import { AccountMenu } from '../AccountMenu'
import { Dropdown, MenuItem } from '../Dropdown'
import { ThemeButtons, ThemeToggle } from '../ThemeToggle'
import { useDocumentChrome } from './documentContext'
import { useMediaQuery } from './state'

/** Below this width the bar's right-hand actions fold into one "⋯" menu. */
export const COMPACT_BAR_QUERY = '(max-width: 860px)'

/** Google Docs-style title field bound to the shared document's `meta.title`. */
function TitleField({ session, readOnly }: { session: Session; readOnly: boolean }) {
  const title = useDocTitle(session)
  return (
    <input
      readOnly={readOnly}
      className="title-input"
      data-tour="title"
      aria-label="Document title"
      title={title || 'Untitled document'}
      placeholder="Untitled document"
      value={title}
      size={Math.min(Math.max(title.length, 12), 40)}
      maxLength={200}
      onChange={(e) => setTitle(session, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

/** The start of the ribbon's bar: ✍️ back to the library, the title, and "View only" for viewers. */
export function DocumentTitle({ session }: { session: Session }) {
  const { role, view } = useDocumentChrome()
  const compact = useMediaQuery(COMPACT_BAR_QUERY)
  return (
    <div className="ribbon-brand">
      <a className="logo-link" href={libraryUrl()} title="All documents" data-tour="library-link">
        <span className="logo" aria-hidden>
          ✍️
        </span>
        <span className="sr-only">All documents</span>
      </a>
      <TitleField session={session} readOnly={view.readOnly} />
      {/* On a phone the status bar's own badge says it. */}
      {role === 'viewer' && !compact && (
        <span className="view-only-badge" data-tour="view-only" title="You can read, copy and export this document, but not change it.">
          View only
        </span>
      )}
    </div>
  )
}

function Avatars({ presence, max }: { presence: Presence[]; max: number }) {
  const shown = presence.slice(0, max)
  const extra = presence.length - shown.length
  return (
    <>
      {shown.map((person) => (
        <span
          key={person.clientId}
          className={`avatar${person.self ? ' self' : ''}`}
          style={{ background: person.color }}
          title={`${person.email || person.name}${person.self ? ' (you)' : ''}`}
        >
          <span aria-hidden>{initialOf(person.name)}</span>
          <span className="sr-only">{`${person.name && person.email && person.name !== person.email ? `${person.name} (${person.email})` : person.name || person.email}${person.self ? ' (you)' : ''}`}</span>
        </span>
      ))}
      {extra > 0 && <span className="avatar more">
          <span aria-hidden>+{extra}</span>
          <span className="sr-only">{`and ${extra} more`}</span>
        </span>}
    </>
  )
}

const peopleLabel = (count: number) => `${count} ${count === 1 ? 'person' : 'people'} here`

/**
 * The end of the ribbon's bar: who's here, Share, theme, account and tours. On a narrow screen
 * they fold into one "⋯" menu, so the bar never scrolls the page sideways.
 */
export function BarActions({ presence }: { presence: Presence[] }) {
  const compact = useMediaQuery(COMPACT_BAR_QUERY)
  return compact ? <OverflowMenu presence={presence} /> : <WideActions presence={presence} />
}

function ShareButton() {
  const { role, share } = useDocumentChrome()
  const isOwner = role === 'owner'
  const Icon = isOwner ? UserPlus : Users
  return (
    <button
      type="button"
      className="ribbon-share"
      data-tour="share"
      onClick={share}
      title={isOwner ? 'Share this document' : 'See who has access'}
    >
      <Icon aria-hidden size={16} />
      Share
    </button>
  )
}

function WideActions({ presence }: { presence: Presence[] }) {
  return (
    <div className="ribbon-actions">
      <div className="presence" data-tour="presence" aria-label={peopleLabel(presence.length)} role="group">
        <Avatars presence={presence} max={4} />
      </div>
      <ShareButton />
      <ThemeToggle />
      <AccountMenu />
      <Dropdown label="?" title="Guided tours" tour="help" align="end" className="help" fixed>
        {(close) => <TourItems onDone={close} />}
      </Dropdown>
    </div>
  )
}

/** The document tours, for the "?" menu and the "⋯" menu. */
function TourItems({ onDone }: { onDone: () => void }) {
  return toursFor('document').map(([id, tour]) => (
    <MenuItem
      key={id}
      onSelect={() => {
        onDone()
        // Let the menu close before driver.js measures the page.
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

/**
 * Everything the wide bar shows, as one popover with sections. A disclosure rather than a menu,
 * since it holds text (who's here, your email) as well as buttons. Tour steps about who's here,
 * Share, the theme, your account and the tours point at it on a phone (`data-tour="more"`).
 */
function OverflowMenu({ presence }: { presence: Presence[] }) {
  const me = useMe()
  const { role, share } = useDocumentChrome()
  const action = accountAction(me)
  return (
    <div className="ribbon-actions">
      <Dropdown
        label={<Ellipsis aria-hidden size={18} />}
        title="More: people, share, theme, account and tours"
        tour="more"
        align="end"
        className="ribbon-more"
        kind="disclosure"
        fixed
      >
        {(close) => {
          const run = (fn: () => void) => () => {
            close()
            fn()
          }
          return (
            <div className="overflow-menu">
              <p className="overflow-heading">{peopleLabel(presence.length)}</p>
              <div className="presence overflow-presence">
                <Avatars presence={presence} max={8} />
              </div>
              <button type="button" className="menu-item" onClick={run(share)}>
                {role === 'owner' ? 'Share…' : 'Who has access…'}
              </button>
              <hr />
              <p className="overflow-heading">Theme</p>
              <ThemeButtons />
              <hr />
              <p className="overflow-heading">
                Signed in as <strong className="account-email">{me.email}</strong>
              </p>
              <button type="button" className="menu-item" onClick={run(action.run)}>
                {action.label}
              </button>
              <hr />
              <p className="overflow-heading">Guided tours</p>
              <TourItems onDone={close} />
            </div>
          )
        }}
      </Dropdown>
    </div>
  )
}
