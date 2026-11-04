import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion'
import { SuggestionList, type SuggestionItem, type SuggestionListProps, type SuggestionListRef } from './SuggestionList'

/**
 * Builds a Tiptap suggestion `render()` that shows <SuggestionList> in a popup
 * positioned at the caret with Floating UI.
 */
export function renderSuggestionList(emptyText?: string): SuggestionOptions<SuggestionItem>['render'] {
  return () => {
    let renderer: ReactRenderer<SuggestionListRef, SuggestionListProps> | null = null
    let clientRect: (() => DOMRect | null) | null | undefined
    let stopAutoUpdate: (() => void) | null = null

    const reference = {
      getBoundingClientRect: () => clientRect?.() ?? new DOMRect(),
    }

    const position = () => {
      if (!renderer) return
      const element = renderer.element as HTMLElement
      computePosition(reference, element, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        element.style.left = `${x}px`
        element.style.top = `${y}px`
      })
    }

    const toListProps = (props: SuggestionProps<SuggestionItem>): SuggestionListProps => ({
      items: props.items,
      command: props.command,
      emptyText,
    })

    const destroy = () => {
      stopAutoUpdate?.()
      stopAutoUpdate = null
      renderer?.element.remove()
      renderer?.destroy()
      renderer = null
    }

    return {
      onStart: (props) => {
        clientRect = props.clientRect
        renderer = new ReactRenderer(SuggestionList, { props: toListProps(props), editor: props.editor })
        const element = renderer.element as HTMLElement
        element.classList.add('suggestion-popup')
        document.body.appendChild(element)
        stopAutoUpdate = autoUpdate(reference, element, position)
      },

      onUpdate: (props) => {
        clientRect = props.clientRect
        renderer?.updateProps(toListProps(props))
        const element = renderer?.element as HTMLElement | undefined
        if (element) element.hidden = false
        position()
      },

      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'Escape') {
          const element = renderer?.element as HTMLElement | undefined
          if (element) element.hidden = true
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
