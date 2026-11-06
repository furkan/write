import { Extension, ResizableNodeView } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { columnResizingPluginKey } from '@tiptap/pm/tables'

/*
 * Resizing under zoom. The app zooms the editor with CSS `zoom` (see editor/zoom.ts), so the
 * pointer moves in screen pixels while widths are in layout pixels. Image resizing (Tiptap's
 * ResizableNodeView) and table column resizing (prosemirror-tables) both add the pointer's
 * movement to a layout width, so at 200% the edge ran ahead of the pointer and at 50% behind it.
 * Both are corrected here, by dividing the movement by the zoom, without patching either library.
 */

/** How much an element is drawn larger or smaller than its layout size. */
const scaleOf = (el: HTMLElement) => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1)

// Images: ResizableNodeView turns the pointer's movement since the start into a size in
// `handleResize` (for the mouse and touch alike). Wrapped once, on the shared prototype.
// The zoom is read once when a drag starts, not on every move (layout reads in a hot path).
//
// Tiptap also only ends a drag on `mouseup`, so a touch drag never committed its size and kept
// resizing on later swipes. Touch end/cancel are made to finish it the same way, and the touchmove
// listener it leaves behind is removed.
type Resizable = {
  element: HTMLElement
  handleMap: Map<string, HTMLElement>
  handleMouseUp: () => void
  handleTouchMove: (event: TouchEvent) => void
  dragScale?: number
  attachHandles(): void
  handleResizeStart(event: MouseEvent | TouchEvent, direction: string): void
  handleResize(deltaX: number, deltaY: number): void
}
const resizable = ResizableNodeView.prototype as unknown as Resizable & { zoomAware?: true }
if (!resizable.zoomAware) {
  const { attachHandles, handleResizeStart, handleResize } = resizable
  resizable.attachHandles = function (this: Resizable) {
    attachHandles.call(this)
    // Without this the browser scrolls the page instead of delivering the drag.
    this.handleMap.forEach((handle) => (handle.style.touchAction = 'none'))
  }
  resizable.handleResizeStart = function (this: Resizable, event, direction) {
    handleResizeStart.call(this, event, direction)
    this.dragScale = scaleOf(this.element)
    if (!('touches' in event)) return
    const end = () => {
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', end)
      document.removeEventListener('touchmove', this.handleTouchMove)
      this.handleMouseUp()
    }
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', end)
  }
  resizable.handleResize = function (this: Resizable, deltaX: number, deltaY: number) {
    const scale = this.dragScale ?? scaleOf(this.element)
    handleResize.call(this, deltaX / scale, deltaY / scale)
  }
  resizable.zoomAware = true
}

/** Events this module sent itself, which it lets through. */
const corrected = new WeakSet<Event>()

/**
 * Tables: while a column border is dragged, prosemirror-tables reads `clientX` from the window's
 * mousemove and mouseup. Those events are caught first (window, capture phase) and sent again with
 * the movement since the drag started divided by the zoom.
 */
const columnDragPlugin = () =>
  new Plugin({
    key: new PluginKey('zoomedColumnDrag'),
    view: (view) => {
      const correct = (event: MouseEvent) => {
        if (corrected.has(event)) return
        const dragging = columnResizingPluginKey.getState(view.state)?.dragging
        if (!dragging) return
        const scale = scaleOf(view.dom)
        if (Math.abs(scale - 1) < 0.001) return
        event.stopImmediatePropagation()
        const copy = new MouseEvent(event.type, {
          bubbles: true,
          cancelable: true,
          clientX: dragging.startX + (event.clientX - dragging.startX) / scale,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          button: event.button,
          buttons: event.buttons,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        })
        corrected.add(copy)
        view.dom.ownerDocument.dispatchEvent(copy)
      }
      window.addEventListener('mousemove', correct, true)
      window.addEventListener('mouseup', correct, true)
      return {
        destroy: () => {
          window.removeEventListener('mousemove', correct, true)
          window.removeEventListener('mouseup', correct, true)
        },
      }
    },
  })

/** Keeps image and table column resizing under the pointer at any zoom. */
export const ZoomedResize = Extension.create({
  name: 'zoomedResize',
  addProseMirrorPlugins: () => [columnDragPlugin()],
})
