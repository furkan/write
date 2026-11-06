import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

type DropdownProps = {
  label: ReactNode
  title: string
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
  tour?: string
  disabled?: boolean
  /**
   * `menu` (default): a menu of `MenuItem`s. `disclosure`: a popover that may hold other content
   * (text, plain buttons), announced as an expandable group rather than a menu.
   */
  kind?: 'menu' | 'disclosure'
  /**
   * Position the menu against the viewport (Floating UI) instead of its parent, so a scrolling
   * container such as the ribbon panel can't clip it.
   */
  fixed?: boolean
}

const menuItems = (menu: HTMLElement | null) => [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]

const focusFirstItem = (menu: HTMLElement | null) => {
  const items = menuItems(menu)
  ;(items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
}

/** A small accessible popover menu that closes on outside click or Escape. */
export function Dropdown({ label, title, children, align = 'start', className, tour, disabled, kind = 'menu', fixed }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  // A fixed menu is hidden until positioned, and a hidden item can't take focus: it waits for that.
  const focusPending = useRef(false)
  const typeahead = useRef({ text: '', timer: 0 })

  // Disabled while open (say, a demotion to viewer): close, so its items can't run.
  if (disabled && open) setOpen(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    const menu = menuRef.current
    if (!open || !fixed || !root || !menu) return
    focusPending.current = kind === 'menu'
    return autoUpdate(root, menu, () => {
      void computePosition(root, menu, {
        strategy: 'fixed',
        placement: align === 'end' ? 'bottom-end' : 'bottom-start',
        middleware: [
          offset(4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          // Never taller than the room left on screen; it scrolls instead.
          size({ padding: 8, apply: ({ availableHeight }) => void (menu.style.maxHeight = `${Math.max(120, Math.min(480, availableHeight))}px`) }),
          // Hidden while its trigger is scrolled out of view (in the ribbon panel, say).
          hide(),
        ],
      }).then(({ x, y, middlewareData }) =>
        {
          Object.assign(menu.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
          })
          if (focusPending.current && menu.style.visibility === 'visible') {
            focusPending.current = false
            focusFirstItem(menu)
          }
        },
      )
    })
  }, [open, fixed, align, kind])

  // A menu opens with focus on its current (checked) item, else the first one.
  useEffect(() => {
    if (open && kind === 'menu' && !fixed) focusFirstItem(menuRef.current)
  }, [open, kind, fixed])

  // Choosing an item closes the menu; focus goes back to the trigger unless the action put it
  // somewhere else (the editor, a dialog). Once the menu is gone a focused item leaves it on <body>.
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body) buttonRef.current?.focus()
    })
  }, [])

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (kind !== 'menu' || event.altKey || event.ctrlKey || event.metaKey) return
    const items = menuItems(menuRef.current)
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      event.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (event.key === 'Tab') {
      // Focus the trigger first, so Tab carries on from there rather than from a vanished item.
      buttonRef.current?.focus()
      setOpen(false)
    } else if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(-1)
    else if (event.key.length === 1 && event.key !== ' ') {
      // Type-ahead: letters typed in quick succession match the start of an item's text.
      const t = typeahead.current
      window.clearTimeout(t.timer)
      t.text += event.key.toLowerCase()
      t.timer = window.setTimeout(() => (t.text = ''), 600)
      const starts = (i: HTMLElement) => i.textContent.trim().toLowerCase().startsWith(t.text)
      // Search from the item after the current one, wrapping round.
      const order = [...items.slice(at + 1), ...items.slice(0, at + 1)]
      const hit = order.find(starts) ?? (t.text.length > 1 ? items.find(starts) : undefined)
      if (hit) {
        event.preventDefault()
        hit.focus()
      }
    }
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // Capture phase, so this Escape closes only the menu, not what contains it (the ribbon's
    // flyout). Focus inside the menu goes back to its button.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`dropdown ${className ?? ''}`} ref={rootRef} data-tour={tour}>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup={kind === 'menu' ? 'menu' : undefined}
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (kind === 'menu' && !open && event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={`dropdown-menu align-${align}${fixed ? ' fixed' : ''}`}
          role={kind === 'menu' ? 'menu' : 'group'}
          aria-label={kind === 'menu' ? undefined : title}
          id={menuId}
          onKeyDown={onMenuKey}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

type MenuItemProps = {
  onSelect: () => void
  children: ReactNode
  hint?: string
  disabled?: boolean
  active?: boolean
  /** One choice of several (a radio item): whether it is the current one. Implies `active`. */
  checked?: boolean
}

export function MenuItem({ onSelect, children, hint, disabled, active, checked }: MenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={`menu-item${active || checked ? ' active' : ''}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      <span>{children}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
}
