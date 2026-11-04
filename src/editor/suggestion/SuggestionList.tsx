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
}

export type SuggestionListRef = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/** Keyboard-navigable popup list shared by slash commands, mentions and emoji. */
export const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(function SuggestionList(
  { items, command, emptyText = 'No results' },
  ref,
) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [items])

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
    <div className="suggestion-list" role="listbox" ref={listRef}>
      {items.length === 0 ? (
        <div className="suggestion-empty">{emptyText}</div>
      ) : (
        items.map((item, index) => (
          <button
            type="button"
            role="option"
            key={item.id}
            aria-selected={index === selected}
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
  )
})
