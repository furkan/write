import { readStorage, writeStorage } from '../../editor/storage'
import { useCallback, useSyncExternalStore } from 'react'
import { createStore, useStore } from '../../store'

export type RibbonTab = 'file' | 'home' | 'insert' | 'layout' | 'view' | 'table' | 'code'

const COLLAPSED_KEY = 'write:ribbon-collapsed'

type RibbonView = {
  /** The selected tab. A contextual tab that is no longer shown falls back to Home. */
  tab: RibbonTab
  /** Only the tab row shows; remembered per browser. */
  collapsed: boolean
  /** While collapsed, the selected tab's panel is open over the document. */
  flyout: boolean
}

/** Module state, so tours can show the Home tab before they look for its groups. */
const view = createStore<RibbonView>({ tab: 'home', collapsed: readStorage(COLLAPSED_KEY) === '1', flyout: false })
const update = (patch: Partial<RibbonView>) => view.set({ ...view.get(), ...patch })

export const useRibbonView = () => useStore(view)

/** A click on a tab. Collapsed, it opens that tab over the document, or closes it if it was open. */
export function clickTab(tab: RibbonTab) {
  const { collapsed, flyout, tab: current } = view.get()
  update({ tab, flyout: collapsed && !(flyout && current === tab) })
}

/** Arrow keys on the tab row: select without opening or closing anything. */
export const focusTab = (tab: RibbonTab) => update({ tab })

export function setCollapsed(collapsed: boolean) {
  writeStorage(COLLAPSED_KEY, collapsed ? '1' : '0')
  update({ collapsed, flyout: false })
}

export const closeFlyout = () => view.get().flyout && update({ flyout: false })

/** For tours: show a tab's groups (Home by default), over the document if the ribbon is collapsed. */
export const revealTab = (tab: RibbonTab = 'home') => update({ tab, flyout: view.get().collapsed })

/**
 * The colour each split button applies, for the rest of the page's life: module state, since the
 * Home tab unmounts on every tab switch. Starts at Word's red text and yellow highlight.
 */
export type ColorKind = 'text' | 'highlight'
const lastColors = createStore<Record<ColorKind, string>>({ text: '#e11d48', highlight: '#fef08a' })
export const useLastColor = (kind: ColorKind) => useStore(lastColors)[kind]
export const setLastColor = (kind: ColorKind, color: string) => lastColors.set({ ...lastColors.get(), [kind]: color })

/** Whether a media query matches, following changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
