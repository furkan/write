import { createStore } from './store'

/**
 * One short message at the bottom of the document page (components/Toast.tsx), for things that
 * happen away from where you clicked: e.g. the ribbon's flyout may have closed by the time a PDF
 * download fails. A newer message replaces the current one.
 */

export type ToastMessage = { id: number; text: string; tone: 'info' | 'error' }

export const toast = createStore<ToastMessage | null>(null)
let nextId = 1

export function showToast(text: string, tone: ToastMessage['tone'] = 'info') {
  toast.set({ id: nextId++, text, tone })
}
