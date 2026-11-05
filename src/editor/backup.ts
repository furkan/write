import type { Editor, JSONContent } from '@tiptap/react'
import { readStorage, writeStorage } from './storage'

/**
 * A local safety net on top of collaboration: your own changes are snapshotted to
 * localStorage (debounced from `onUpdate`), and can be restored from the File menu.
 * Keyed by User as well as document, so two people sharing a browser profile never see
 * each other's backups. Viewers take none: they can't change the document.
 */

const keyFor = (email: string, documentName: string) => `write:backup:${email}:${documentName}`
/** Before per-user access, backups were keyed by document only. */
const legacyKeyFor = (documentName: string) => `write:backup:${documentName}`

export type Backup = { savedAt: number; content: JSONContent }

export const BACKUP_EVENT = 'write:backup-saved'

function storeBackup(email: string, documentName: string, backup: Backup): boolean {
  const ok = writeStorage(keyFor(email, documentName), JSON.stringify(backup))
  if (ok) window.dispatchEvent(new CustomEvent<Backup>(BACKUP_EVENT, { detail: backup }))
  return ok
}

export const saveBackup = (editor: Editor, email: string, documentName: string): boolean =>
  storeBackup(email, documentName, { savedAt: Date.now(), content: editor.getJSON() })

function readBackup(key: string): Backup | null {
  try {
    const backup = JSON.parse(readStorage(key) ?? 'null') as Backup | null
    return backup?.content && typeof backup.savedAt === 'number' ? backup : null
  } catch {
    return null
  }
}

/** Your backup of a document. */
export const loadBackup = (email: string, documentName: string): Backup | null => readBackup(keyFor(email, documentName))

/**
 * For the document's owner: copies a backup made under the pre-ownership key to the owner's
 * key. Those backups were made in this browser before documents had owners, and the migration
 * gave every such document to the Legacy owner, so only the owner gets them (never a
 * collaborator). Never replaces a backup that is as new or newer, so it copies at most once.
 * The old key is left as it was.
 */
export function adoptLegacyBackup(email: string, documentName: string): boolean {
  const legacy = readBackup(legacyKeyFor(documentName))
  if (!legacy) return false
  const current = loadBackup(email, documentName)
  if (current && current.savedAt >= legacy.savedAt) return false
  return storeBackup(email, documentName, legacy)
}
