import { createStore, useStore, type Store } from '../store'
import { readStorage, writeStorage } from './storage'

/*
 * View tab switches that are yours alone: remembered per browser, never stored in the document.
 * Each is a boolean with a default for "nothing saved yet".
 */

function pref(key: string, fallback: boolean, apply?: (on: boolean) => void) {
  const saved = readStorage(key)
  const store: Store<boolean> = createStore(saved === null ? fallback : saved === '1')
  apply?.(store.get())
  return {
    use: () => useStore(store),
    get: store.get,
    set(on: boolean) {
      writeStorage(key, on ? '1' : '0')
      store.set(on)
      apply?.(on)
    },
  }
}

/** The ruler above the page (Print layout). On by default, like Word's. */
export const rulerPref = pref('write:ruler', true)

/** The navigation pane on the left. On by default: the contents used to be on screen from the start. */
export const navPanePref = pref('write:nav-pane', true)

/**
 * "Dark page" (Word's Switch Modes): in the dark theme the page stays white unless this is on.
 * Off by default. Applied as `<html data-dark-page>`, which index.css reads; printing and the PDF
 * are always white.
 */
export const darkPagePref = pref('write:dark-page', false, (on) => document.documentElement.toggleAttribute('data-dark-page', on))
