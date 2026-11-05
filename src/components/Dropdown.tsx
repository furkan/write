import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

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
}

/** A small accessible popover menu that closes on outside click or Escape. */
export function Dropdown({ label, title, children, align = 'start', className, tour, disabled, kind = 'menu' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`dropdown ${className ?? ''}`} ref={rootRef} data-tour={tour}>
      <button
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
          className={`dropdown-menu align-${align}`}
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
