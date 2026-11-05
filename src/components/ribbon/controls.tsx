import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Dropdown } from '../Dropdown'
import { keepSelection, tooltip } from './editorState'
import { setLastColor, useLastColor, type ColorKind } from './state'

/** A labelled group of controls, with its name centred underneath. */
export function RibbonGroup({ label, tour, children }: { label: string; tour?: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="ribbon-group" role="group" aria-labelledby={id} data-tour={tour}>
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label" id={id}>
        {label}
      </div>
    </div>
  )
}

type ButtonProps = {
  label: string
  shortcut?: string
  icon?: LucideIcon
  /** A custom glyph instead of an icon (B, I, U…). */
  glyph?: ReactNode
  /**
   * `small`: icon only. `medium`: icon and label in a row (stacked three high).
   * `large`: icon above its label.
   */
  size?: 'small' | 'medium' | 'large'
  /** For toggles: whether it is on. Leave undefined for plain commands. */
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

export function RibbonButton({ label, shortcut, icon: Icon, glyph, size = 'small', active, disabled, onClick }: ButtonProps) {
  const title = tooltip(label, shortcut)
  return (
    <button
      type="button"
      className={`ribbon-btn ${size}${active ? ' active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      {glyph ?? (Icon && <Icon aria-hidden size={size === 'large' ? 24 : 16} strokeWidth={size === 'large' ? 1.6 : 2} />)}
      {size !== 'small' && <span className="ribbon-btn-label">{label}</span>}
    </button>
  )
}

type MenuButtonProps = {
  label: string
  icon: LucideIcon
  disabled?: boolean
  /** `disclosure` for popovers that aren't a list of menu items (grids, swatches). */
  kind?: 'menu' | 'disclosure'
  tour?: string
  children: (close: () => void) => ReactNode
}

/** A large button that opens a menu, with a chevron under its label. */
export function RibbonMenuButton({ label, icon: Icon, disabled, kind, tour, children }: MenuButtonProps) {
  return (
    <Dropdown
      fixed
      kind={kind}
      tour={tour}
      className="ribbon-menu-button"
      title={label}
      disabled={disabled}
      label={
        <>
          <Icon aria-hidden size={24} strokeWidth={1.6} />
          <span className="ribbon-btn-label">{label}</span>
          <ChevronDown aria-hidden className="ribbon-menu-chevron" size={12} />
        </>
      }
    >
      {children}
    </Dropdown>
  )
}

type Swatch = { color: string; name: string }

type ColorSplitProps = {
  label: string
  shortcut?: string
  /** What the main part shows above the colour bar. */
  glyph: ReactNode
  colors: Swatch[]
  /** Which last-used colour the main part applies. */
  kind: ColorKind
  clearLabel: string
  disabled?: boolean
  onApply: (color: string) => void
  onClear: () => void
}

/**
 * Word's colour split button: the main part applies the last colour picked, the arrow opens the
 * swatches.
 */
export function ColorSplitButton({ label, shortcut, glyph, colors, kind, clearLabel, disabled, onApply, onClear }: ColorSplitProps) {
  const last = useLastColor(kind)
  const lastName = colors.find((c) => c.color === last)?.name ?? last
  const title = `${label}: ${lastName}`
  return (
    <div className="ribbon-split">
      <button
        type="button"
        className="ribbon-btn small"
        title={tooltip(title, shortcut)}
        aria-label={title}
        disabled={disabled}
        onMouseDown={keepSelection}
        onClick={() => onApply(last)}
      >
        <span className="color-glyph" aria-hidden>
          {glyph}
          <span className="color-bar" style={{ background: last }} />
        </span>
      </button>
      <Dropdown fixed kind="disclosure" className="ribbon-split-arrow" title={`${label}: choose a colour`} disabled={disabled} label={<ChevronDown aria-hidden size={12} />}>
        {(close) => (
          <div className="swatch-panel">
            <div className="swatches">
              {colors.map(({ color, name }) => (
                <button
                  key={color}
                  type="button"
                  className={`swatch${color === last ? ' current' : ''}`}
                  style={{ background: color }}
                  title={name}
                  aria-label={`${label}: ${name}`}
                  onMouseDown={keepSelection}
                  onClick={() => {
                    setLastColor(kind, color)
                    onApply(color)
                    close()
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="menu-item"
              onMouseDown={keepSelection}
              onClick={() => {
                onClear()
                close()
              }}
            >
              {clearLabel}
            </button>
          </div>
        )}
      </Dropdown>
    </div>
  )
}
