import type { ReactNode } from 'react'

type ToolButtonProps = {
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
  shortcut?: string
}

/** Toolbar button that keeps the editor selection (no focus steal on mousedown). */
export function ToolButton({ title, onClick, active, disabled, children, shortcut }: ToolButtonProps) {
  const label = shortcut ? `${title} (${shortcut})` : title
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={active ? 'active' : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
