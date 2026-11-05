import type { HocuspocusProvider } from '@hocuspocus/provider'
import { ApiError, fetchPdf, isSessionError } from '../api'
import { showToast } from '../toast'
import { createStore, useStore } from '../store'
import type { Session } from './collab'

/**
 * Download as PDF (File tab): the server prints the stored document with its page setup and
 * "Page N of M", and none of the headers a browser's print dialog adds (server/pdf.ts). Edits it
 * hasn't received yet aren't in it, so wait a moment for them first.
 */

/** How long to wait for unsynced edits to reach the server before asking for the PDF. */
const SYNC_WAIT_MS = 3000

/** True while a PDF is being prepared (one at a time per tab). */
const preparing = createStore(false)

export const usePreparingPdf = () => useStore(preparing)

/** Resolves true once the server has every local change, or false after `ms`. */
function waitForSync(provider: HocuspocusProvider, ms: number): Promise<boolean> {
  if (provider.unsyncedChanges === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (synced: boolean) => {
      window.clearTimeout(timer)
      provider.off('unsyncedChanges', check)
      resolve(synced)
    }
    const check = () => {
      if (provider.unsyncedChanges === 0) done(true)
    }
    const timer = window.setTimeout(() => done(provider.unsyncedChanges === 0), ms)
    provider.on('unsyncedChanges', check)
  })
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function failure(error: unknown): string {
  if (isSessionError(error)) return 'Your session expired. Sign in again (see the banner), then download the PDF.'
  if (error instanceof ApiError) {
    if (error.status === 503) return error.detail ?? 'PDF download isn’t available right now. Try again in a moment.'
    if (error.status === 413) return 'This document is too large to download as a PDF.'
    if (error.status === 404) return 'You no longer have access to this document.'
    return 'The PDF could not be made. Try again in a moment.'
  }
  return 'Write can’t reach the server. Try again when you’re back online.'
}

export async function downloadPdf(session: Session) {
  if (preparing.get()) return
  preparing.set(true)
  try {
    const synced = await waitForSync(session.provider, SYNC_WAIT_MS)
    const { blob, filename } = await fetchPdf(session.name)
    save(blob, filename)
    if (!synced) showToast('Some recent edits aren’t saved yet and won’t be in the PDF.')
  } catch (error) {
    showToast(failure(error), 'error')
  } finally {
    preparing.set(false)
  }
}
