/*
 * The document page is an app shell: the ribbon and the status bar stay put and only the document
 * area scrolls, in its own element (`.doc-scroll`). This module knows that element, for code set up
 * before it exists (the editor's extensions).
 */

let element: HTMLElement | null = null
const listeners = new Set<EventListener>()

/** The document's scroller, once the document page has mounted it. */
export const getDocumentScroller = () => element

/** Called by the document page when its scroller mounts (and with `null` when it unmounts). */
export function setDocumentScroller(next: HTMLElement | null) {
  for (const listener of listeners) element?.removeEventListener('scroll', listener)
  element = next
  for (const listener of listeners) element?.addEventListener('scroll', listener, { passive: true })
}

/** How far below a heading's top the window's top may be for it to count as scrolled to. */
const ACTIVE_SLACK = 32

/**
 * The table of contents' `scrollParent`. The extension marks a heading active once `scrollY` reaches
 * its `offsetTop`, which is relative to the editor and in its layout pixels (unzoomed). So `scrollY`
 * here is how far the top of the scroller is below the top of the editor, in those same pixels.
 */
export const tocScrollParent = {
  addEventListener(_type: 'scroll', listener: EventListener) {
    listeners.add(listener)
    element?.addEventListener('scroll', listener, { passive: true })
  },
  removeEventListener(_type: 'scroll', listener: EventListener) {
    listeners.delete(listener)
    element?.removeEventListener('scroll', listener)
  },
  get scrollY(): number {
    const editor = element?.querySelector<HTMLElement>('.editor .tiptap')
    if (!element || !editor) return 0
    const rect = editor.getBoundingClientRect()
    const scale = editor.offsetWidth ? rect.width / editor.offsetWidth : 1
    return (element.getBoundingClientRect().top - rect.top) / scale + ACTIVE_SLACK
  },
}
