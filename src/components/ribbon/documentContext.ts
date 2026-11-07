import { createContext, useContext } from 'react'
import type { Role } from '../../api'

/** View preferences for this tab (the View tab). */
export type ViewOptions = {
  readOnly: boolean
  invisibles: boolean
  focusMode: boolean
}

/**
 * What the document page gives the ribbon beyond the editor: who you are here, the view, and the
 * page-level actions (share, backup). The File and View tabs and the bar's actions use it.
 */
export type DocumentChrome = {
  /** The caller's role; `null` while unknown (opened offline). */
  role: Role | null
  /** With `readOnly` already forced on for viewers and closed documents. */
  view: ViewOptions
  /** False for viewers (always read-only) and closed documents. */
  canToggleReadOnly: boolean
  setView: (next: Partial<ViewOptions>) => void
  /** Save a local backup now (owners and editors). */
  backup: () => void
  /** Open the share dialog ("Who has access" for everyone but the owner). */
  share: () => void
  /** The zoom shown now, in percent (a fit's result included). */
  zoom: number
}

export const DocumentChromeContext = createContext<DocumentChrome | null>(null)

export function useDocumentChrome(): DocumentChrome {
  const chrome = useContext(DocumentChromeContext)
  if (!chrome) throw new Error('useDocumentChrome outside the document page')
  return chrome
}

/** Viewers, and anyone whose role isn't known yet, don't get the actions that change the document. */
export const canWrite = (role: Role | null) => role === 'owner' || role === 'editor'
