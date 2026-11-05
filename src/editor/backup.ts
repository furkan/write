import type { Editor, JSONContent } from '@tiptap/react'
import { readStorage, writeStorage } from './storage'

/**
 * A local safety net on top of collaboration: your own changes are snapshotted to
 * localStorage (debounced from `onUpdate`), and can be restored from the File menu.
 * Keyed by User as well as document, so two people sharing a browser profile never see
 * each other's backups. Viewers take none: they can't change the document.
 */

const keyFor = (email: string, documentName: string) => `write:backup:${email}:${documentName}`

export type Backup = { savedAt: number; content: JSONContent }

export const BACKUP_EVENT = 'write:backup-saved'

export function saveBackup(editor: Editor, email: string, documentName: string): boolean {
  const backup: Backup = { savedAt: Date.now(), content: editor.getJSON() }
  const ok = writeStorage(keyFor(email, documentName), JSON.stringify(backup))
  if (ok) window.dispatchEvent(new CustomEvent<Backup>(BACKUP_EVENT, { detail: backup }))
  return ok
}

export function loadBackup(email: string, documentName: string): Backup | null {
  try {
    const backup = JSON.parse(readStorage(keyFor(email, documentName)) ?? 'null') as Backup | null
    return backup?.content ? backup : null
  } catch {
    return null
  }
}
