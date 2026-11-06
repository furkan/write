export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The primary modifier key label for shortcut hints. */
export const mod = isMac ? '⌘' : 'Ctrl'

/** "Ctrl+Shift+Z" / "⌘+B" as an aria-keyshortcuts value ("Control+Shift+Z", "Meta+B"). */
export const ariaKeys = (shortcut?: string) => shortcut?.replace('Ctrl', 'Control').replace('⌘', 'Meta')
