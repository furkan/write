import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'

export type SuggestionItem = {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  [key: string]: unknown
}

export type SuggestionListProps = {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
  emptyText?: string
  /** Id of the listbox, and the prefix of its options' ids (`<listId>-option-<index>`). */
  listId: string
  /** The listbox's accessible name: Commands, Mentions or Emoji. */
  label: string
  /** The highlighted option's id, or null when there is none to point at (no matches). */
  onActiveChange?: (optionId: string | null) => void
}

export type SuggestionListRef = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/** Keyboard-navigable popup list shared by slash commands, mentions and emoji. */
export const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(function SuggestionList(
  { items, command, emptyText = 'No results', listId, label, onActiveChange },
  ref,
) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [items])

  // `selected` lags `items` by one render when the list shrinks.
  const active = items.length ? `${listId}-option-${Math.min(selected, items.length - 1)}` : null
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  // The empty message goes in a live region that was already mounted (they announce changes, not
  // arrivals), so it is filled in a render after the popup opens.
  const [announce, setAnnounce] = useState('')
  const noMatches = items.length === 0
  useEffect(() => {
    setAnnounce(noMatches ? emptyText : '')
  }, [noMatches, emptyText])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const choose = (index: number) => {
    const item = items[index]
    if (item) command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') {
        setSelected((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        choose(selected)
        return true
      }
      return false
    },
  }))

  return (
    <>
      <div
        className="suggestion-list"
        id={listId}
        role={noMatches ? undefined : 'listbox'}
        aria-label={noMatches ? undefined : label}
        ref={listRef}
      >
        {noMatches ? (
          <div className="suggestion-empty" aria-hidden>
            {emptyText}
          </div>
        ) : (
          items.map((item, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              key={item.id}
              aria-selected={index === selected}
              tabIndex={-1}
              className="suggestion-item"
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(index)}
            >
              {item.icon !== undefined && <span className="suggestion-icon">{item.icon}</span>}
              <span className="suggestion-label">{item.label}</span>
              {item.hint && <span className="suggestion-hint">{item.hint}</span>}
            </button>
          ))
        )}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </>
  )
})
