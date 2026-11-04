import { readStorage, writeStorage } from './editor/storage'

/** Light / dark / follow-the-system theme, stored per browser and applied as `<html data-theme>`. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'write:theme'
export const THEME_EVENT = 'write:theme-change'

export function getThemeChoice(): ThemeChoice {
  const saved = readStorage(KEY)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function setThemeChoice(choice: ThemeChoice) {
  writeStorage(KEY, choice)
  applyTheme(choice)
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }))
}
