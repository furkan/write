import type { Editor, JSONContent } from '@tiptap/react'
import { documentName } from './collab'
import { readStorage, writeStorage } from './storage'

/**
 * A local safety net on top of collaboration: every change is snapshotted to
 * localStorage (debounced from `onUpdate`), and can be restored from the File menu.
 */

const key = `write:backup:${documentName}`

export type Backup = { savedAt: number; content: JSONContent }

export const BACKUP_EVENT = 'write:backup-saved'

export function saveBackup(editor: Editor): boolean {
  const backup: Backup = { savedAt: Date.now(), content: editor.getJSON() }
  const ok = writeStorage(key, JSON.stringify(backup))
  if (ok) window.dispatchEvent(new CustomEvent<Backup>(BACKUP_EVENT, { detail: backup }))
  return ok
}

export function loadBackup(): Backup | null {
  try {
    const backup = JSON.parse(readStorage(key) ?? 'null') as Backup | null
    return backup?.content ? backup : null
  } catch {
    return null
  }
}
