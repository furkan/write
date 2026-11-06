import { useEffect, useState } from 'react'
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

/** The theme choice, kept in step across every theme control (and tab) on the page. */
export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice)
  useEffect(() => {
    const onChange = (event: Event) => setChoice((event as CustomEvent<ThemeChoice>).detail)
    window.addEventListener(THEME_EVENT, onChange)
    return () => window.removeEventListener(THEME_EVENT, onChange)
  }, [])
  return choice
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Whether the app is showing its dark theme: chosen, or the system's when following it. */
export function useDarkTheme(): boolean {
  const choice = useThemeChoice()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return choice === 'dark' || (choice === 'system' && systemDark)
}
