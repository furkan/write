import { readStorage, writeStorage } from '../../editor/storage'
import { createStore, useStore } from '../../store'

export type RibbonTab = 'home' | 'insert' | 'table' | 'code'

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

/** For tours: show the Home tab's groups, over the document if the ribbon is collapsed. */
export const revealHomeTab = () => update({ tab: 'home', flyout: view.get().collapsed })
