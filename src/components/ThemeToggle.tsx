import type { ReactNode } from 'react'
import { setThemeChoice, useThemeChoice, type ThemeChoice } from '../theme'
import { Dropdown, MenuItem } from './Dropdown'

const svg = (children: ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
)

const SunIcon = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
)
const MoonIcon = svg(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />)
const SystemIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
)

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: SystemIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
]

/** System, Light and Dark as menu choices, the current one checked. */
export function ThemeMenuItems({ onDone }: { onDone: () => void }) {
  const choice = useThemeChoice()
  return THEME_OPTIONS.map((option) => (
    <MenuItem
      key={option.value}
      checked={option.value === choice}
      onSelect={() => {
        setThemeChoice(option.value)
        onDone()
      }}
    >
      <span className="menu-icon">{option.icon}</span> {option.label}
      {option.value === choice ? ' ✓' : ''}
    </MenuItem>
  ))
}

/** System, Light and Dark as toggle buttons, for a popover that isn't a menu. */
export function ThemeButtons() {
  const choice = useThemeChoice()
  return (
    <div className="theme-buttons" role="group" aria-label="Theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`menu-item${choice === option.value ? ' active' : ''}`}
          aria-pressed={choice === option.value}
          onClick={() => setThemeChoice(option.value)}
        >
          <span>
            <span className="menu-icon">{option.icon}</span> {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Menu button for picking the colour theme; the choice is remembered per browser. */
export function ThemeToggle() {
  const choice = useThemeChoice()
  const current = THEME_OPTIONS.find((o) => o.value === choice) ?? THEME_OPTIONS[0]

  return (
    <Dropdown
      label={<span className="theme-icon">{current.icon}</span>}
      title={`Theme: ${current.label}`}
      tour="theme"
      align="end"
      className="theme-toggle"
    >
      {(close) => <ThemeMenuItems onDone={close} />}
    </Dropdown>
  )
}
