import { useState, type FocusEvent } from 'react'
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

/**
 * Props for a toast element: `paused` is true while the pointer is over it or focus is inside it,
 * so the auto-dismiss timer can wait (someone reading it, or on its way to "Undo", keeps it).
 */
export function usePauseOnInteraction() {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return {
    paused: hovered || focused,
    props: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      },
    },
  }
}
