import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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

/** A small accessible popover menu that closes on outside click or Escape. */
export function Dropdown({ label, title, children, align = 'start', className, tour, disabled, kind = 'menu', fixed }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Disabled while open (say, a demotion to viewer): close, so its items can't run.
  if (disabled && open) setOpen(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    const menu = menuRef.current
    if (!open || !fixed || !root || !menu) return
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
        Object.assign(menu.style, {
          left: `${x}px`,
          top: `${y}px`,
          visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
        }),
      )
    })
  }, [open, fixed, align])

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
        >
          {children(() => setOpen(false))}
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
}

export function MenuItem({ onSelect, children, hint, disabled, active }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${active ? ' active' : ''}`}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
    >
      <span>{children}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  )
}
