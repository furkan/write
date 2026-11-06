import { autoUpdate, computePosition, flip, hide, offset, shift, type VirtualElement } from '@floating-ui/dom'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { getDocumentScroller } from '../scroller'
import { SuggestionList, type SuggestionItem, type SuggestionListProps, type SuggestionListRef } from './SuggestionList'

/**
 * Builds a Tiptap suggestion `render()` that shows <SuggestionList> in a popup
 * positioned at the caret with Floating UI. The caret is in the document's own scroller (the page
 * is an app shell), so the reference names the editor as its context: `autoUpdate` then follows
 * that scroller, and the popup stays inside it (off the ribbon and the status bar), hidden while
 * the caret is scrolled out of view.
 */
// The trigger character says what is being suggested; it names the listbox.
const KIND_LABELS: Record<string, string> = { '/': 'Commands', '@': 'Mentions', ':': 'Emoji' }
const ARIA_ATTRS = ['aria-activedescendant', 'aria-controls', 'aria-autocomplete'] as const
let popupCount = 0

export function renderSuggestionList(emptyText?: string, label?: string): SuggestionOptions<SuggestionItem>['render'] {
  return () => {
    let renderer: ReactRenderer<SuggestionListRef, SuggestionListProps> | null = null
    let clientRect: (() => DOMRect | null) | null | undefined
    let stopAutoUpdate: (() => void) | null = null
    let editorDom: HTMLElement | null = null
    let activeId: string | null = null
    let kind = label ?? 'Suggestions'
    const listId = `suggestion-list-${++popupCount}`

    const reference: VirtualElement = {
      getBoundingClientRect: () => clientRect?.() ?? new DOMRect(),
    }

    const position = () => {
      if (!renderer) return
      const element = renderer.element as HTMLElement
      const boundary = getDocumentScroller() ?? 'clippingAncestors'
      computePosition(reference, element, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(6), flip({ padding: 8, boundary }), shift({ padding: 8, boundary }), hide({ boundary })],
      }).then(({ x, y, middlewareData }) => {
        element.style.left = `${x}px`
        element.style.top = `${y}px`
        element.style.visibility = middlewareData.hide?.referenceHidden ? 'hidden' : ''
      })
    }

    // The editor keeps focus, so the highlighted option is announced through the editor's own
    // attributes. Present only while there is a visible list to point at.
    const syncAria = () => {
      if (!editorDom) return
      const element = renderer?.element as HTMLElement | undefined
      if (!element || element.hidden || !activeId || !editorDom.matches(':focus')) {
        for (const name of ARIA_ATTRS) editorDom.removeAttribute(name)
        return
      }
      editorDom.setAttribute('aria-controls', listId)
      editorDom.setAttribute('aria-autocomplete', 'list')
      editorDom.setAttribute('aria-activedescendant', activeId)
    }

    const onActiveChange = (id: string | null) => {
      activeId = id
      syncAria()
    }

    const toListProps = (props: SuggestionProps<SuggestionItem>): SuggestionListProps => ({
      items: props.items,
      command: props.command,
      emptyText,
      listId,
      label: kind,
      onActiveChange,
    })

    const destroy = () => {
      activeId = null
      syncAria()
      editorDom?.removeEventListener('blur', syncAria)
      editorDom?.removeEventListener('focus', syncAria)
      editorDom = null
      stopAutoUpdate?.()
      stopAutoUpdate = null
      renderer?.element.remove()
      renderer?.destroy()
      renderer = null
    }

    return {
      onStart: (props) => {
        clientRect = props.clientRect
        editorDom = props.editor.view.dom
        editorDom.addEventListener('blur', syncAria)
        editorDom.addEventListener('focus', syncAria)
        kind = label ?? KIND_LABELS[props.text?.[0] ?? ''] ?? kind
        reference.contextElement = editorDom
        renderer = new ReactRenderer(SuggestionList, { props: toListProps(props), editor: props.editor })
        const element = renderer.element as HTMLElement
        element.classList.add('suggestion-popup')
        document.body.appendChild(element)
        stopAutoUpdate = autoUpdate(reference, element, position)
        syncAria()
      },

      onUpdate: (props) => {
        clientRect = props.clientRect
        renderer?.updateProps(toListProps(props))
        const element = renderer?.element as HTMLElement | undefined
        if (element) element.hidden = false
        position()
        syncAria()
      },

      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'Escape') {
          const element = renderer?.element as HTMLElement | undefined
          if (element) element.hidden = true
          syncAria()
          return true
        }
        const element = renderer?.element as HTMLElement | undefined
        if (element?.hidden) return false
        return renderer?.ref?.onKeyDown(event) ?? false
      },

      onExit: destroy,
    }
  }
}
