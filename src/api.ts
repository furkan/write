/** Client for the document library API served by `server/collab.ts`. */

export type DocMeta = {
  id: string
  title: string
  preview: string
  words: number
  createdAt: number
  updatedAt: number
}

export type TrashedDoc = DocMeta & {
  /** When it was moved to the Trash. */
  trashedAt: number
  /** When it will be deleted forever. */
  purgeAt: number
}

async function request<T>(path: string, init?: RequestInit, base = '/api/docs'): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) throw new ApiError(response.status)
  return (response.status === 204 ? undefined : await response.json()) as T
}

export class ApiError extends Error {
  status: number
  constructor(status: number) {
    super(`Request failed (${status})`)
    this.status = status
  }
}

export const listDocs = () => request<{ docs: DocMeta[] }>('').then((r) => r.docs)

export const getDoc = (id: string) => request<DocMeta>(`/${encodeURIComponent(id)}`)

export type DocStatus = { deleted: boolean; trashed: boolean; exists: boolean }

export const getDocStatus = (id: string) => request<DocStatus>(`/${encodeURIComponent(id)}/status`)

export const createDoc = (title = '') => request<DocMeta>('', { method: 'POST', body: JSON.stringify({ title }) })

export const renameDoc = (id: string, title: string) =>
  request<DocMeta>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) })

/** Moves a document to the Trash; it can be restored for 30 days. */
export const trashDoc = (id: string) => request<void>(`/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const duplicateDoc = (id: string) => request<DocMeta>(`/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })

const trash = <T>(path: string, init?: RequestInit) => request<T>(path, init, '/api/trash')

export const listTrash = () => trash<{ docs: TrashedDoc[]; retentionDays: number }>('')

export const restoreDoc = (id: string) => trash<DocMeta>(`/${encodeURIComponent(id)}/restore`, { method: 'POST' })

/** Deletes a document in the Trash forever. */
export const deleteForever = (id: string) => trash<void>(`/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Deletes the listed Trash documents forever (the ones the user saw, not anything trashed since). */
export const emptyTrash = (ids: string[]) =>
  trash<{ purged: number }>('', { method: 'DELETE', body: JSON.stringify({ ids }) })

/**
 * Restores a document. If it was already restored (say, by someone else), that counts as
 * success; anything else rethrows.
 */
export async function restoreOrConfirmOpen(id: string): Promise<void> {
  try {
    await restoreDoc(id)
  } catch (error) {
    const status = await getDocStatus(id).catch(() => null)
    if (status && status.exists && !status.trashed && !status.deleted) return
    throw error
  }
}

/** URL of a document; `template` seeds a brand-new document on first open. */
export const docUrl = (id: string, template?: string) => {
  const params = new URLSearchParams({ doc: id })
  if (template) params.set('template', template)
  return `${location.pathname}?${params}`
}

/** URL of the library; `trashed` shows an "Undo" toast for a document just moved to the Trash. */
export const libraryUrl = (trashed?: string) =>
  trashed ? `${location.pathname}?${new URLSearchParams({ trashed })}` : location.pathname

export const trashUrl = () => `${location.pathname}#trash`

/** Display title: the explicit title, else the first words of the document. */
export const displayTitle = (doc: Pick<DocMeta, 'title' | 'preview'>) =>
  doc.title || doc.preview.split(' ').slice(0, 8).join(' ') || 'Untitled document'
