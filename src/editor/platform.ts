export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** The primary modifier key label for shortcut hints. */
export const mod = isMac ? '⌘' : 'Ctrl'
