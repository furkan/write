/** Client for the document library API served by `server/collab.ts`. */

export type DocMeta = {
  id: string
  title: string
  preview: string
  words: number
  createdAt: number
  updatedAt: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/docs${path}`, {
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

export const getDocStatus = (id: string) =>
  request<{ deleted: boolean; exists: boolean }>(`/${encodeURIComponent(id)}/status`)

export const createDoc = (title = '') => request<DocMeta>('', { method: 'POST', body: JSON.stringify({ title }) })

export const renameDoc = (id: string, title: string) =>
  request<DocMeta>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) })

export const deleteDoc = (id: string) => request<void>(`/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const duplicateDoc = (id: string) => request<DocMeta>(`/${encodeURIComponent(id)}/duplicate`, { method: 'POST' })

/** URL of a document; `template` seeds a brand-new document on first open. */
export const docUrl = (id: string, template?: string) => {
  const params = new URLSearchParams({ doc: id })
  if (template) params.set('template', template)
  return `${location.pathname}?${params}`
}

export const libraryUrl = () => location.pathname

/** Display title: the explicit title, else the first words of the document. */
export const displayTitle = (doc: Pick<DocMeta, 'title' | 'preview'>) =>
  doc.title || doc.preview.split(' ').slice(0, 8).join(' ') || 'Untitled document'
