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

export function saveBackup(editor: Editor, email: string, documentName: string): boolean {
  const backup: Backup = { savedAt: Date.now(), content: editor.getJSON() }
  const ok = writeStorage(keyFor(email, documentName), JSON.stringify(backup))
  if (ok) window.dispatchEvent(new CustomEvent<Backup>(BACKUP_EVENT, { detail: backup }))
  return ok
}

function readBackup(key: string): Backup | null {
  try {
    const backup = JSON.parse(readStorage(key) ?? 'null') as Backup | null
    return backup?.content ? backup : null
  } catch {
    return null
  }
}

/**
 * Your backup of a document. `isOwner` also looks under the pre-ownership key: those backups
 * were made in this browser before documents had owners, and the migration gave every such
 * document to the Legacy owner, so only the owner gets them (never a collaborator).
 */
export function loadBackup(email: string, documentName: string, isOwner = false): Backup | null {
  return readBackup(keyFor(email, documentName)) ?? (isOwner ? readBackup(legacyKeyFor(documentName)) : null)
}
