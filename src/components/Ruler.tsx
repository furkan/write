import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { Session } from '../editor/collab'
import { marginsOf, MAX_MARGIN, setPageSetup, type PageSetup } from '../editor/page-setup'
import { IN } from '../editor/paper'
import { cursorParagraph } from './ribbon/paragraph'

/*
 * Word's horizontal ruler above the page (Print layout): ticks in cm or inches, grey margin areas,
 * draggable margin boundaries (they change the page setup, so everyone sees them and Undo takes
 * them back) and the indent markers of the paragraph at the cursor: first line (top, pointing
 * down), hanging and left indent and right indent (bottom). Every handle is a focusable slider:
 * the arrow keys move it by a small step, Shift by a larger one.
 *
 * Everything is measured in layout px from the page's left edge and drawn at `zoom`.
 */

const PX_PER_PT = 4 / 3
const CM = IN / 2.54
/** The text area never gets narrower than this. */
const MIN_TEXT = IN

export type RulerUnit = 'cm' | 'in'

/** A4 and A5 are metric, Letter and Legal use inches: the ruler follows the paper, as Word follows the region. */
const rulerUnit = (setup: PageSetup): RulerUnit => (setup.size === 'a4' || setup.size === 'a5' ? 'cm' : 'in')

const unitPx = (unit: RulerUnit) => (unit === 'cm' ? CM : IN)
/** A small arrow-key step: 1 mm, or 1/16 inch. */
const stepPx = (unit: RulerUnit) => (unit === 'cm' ? CM / 10 : IN / 16)
const label = (px: number, unit: RulerUnit) => `${(px / unitPx(unit)).toFixed(2)} ${unit === 'cm' ? 'cm' : 'in'}`

const HEIGHT = 32

type Para = {
  /** Where the paragraph's text starts and ends without its own indents: the column it sits in. */
  naturalLeft: number
  naturalRight: number
  /** Its own indents, in pt (a first line indent may be negative). */
  left: number
  right: number
  first: number
}

/** Measures the paragraph at the cursor against the page's left edge, undoing zoom. */
function measureParagraph(editor: Editor, zoom: number): Para | null {
  if (editor.isDestroyed) return null
  const { state, view } = editor
  const node = cursorParagraph(state)
  if (!node) return null
  const dom = view.nodeDOM(state.selection.$from.before())
  if (!(dom instanceof HTMLElement)) return null
  const rect = dom.getBoundingClientRect()
  const page = view.dom.getBoundingClientRect()
  const left = (node.attrs.indentLeft as number | null) ?? 0
  const right = (node.attrs.indentRight as number | null) ?? 0
  const first = (node.attrs.indentFirstLine as number | null) ?? 0
  const scale = zoom / 100
  return {
    naturalLeft: (rect.left - page.left) / scale - left * PX_PER_PT,
    naturalRight: (rect.right - page.left) / scale + right * PX_PER_PT,
    left,
    right,
    first,
  }
}

type RulerProps = {
  editor: Editor
  session: Session
  setup: PageSetup
  pageWidth: number
  /** The zoom in percent. */
  zoom: number
  /** False for viewers and Read-only: the ruler still shows, but nothing can be dragged. */
  editable: boolean
}

export function Ruler({ editor, session, setup, pageWidth, zoom, editable }: RulerProps) {
  const unit = rulerUnit(setup)
  const scale = zoom / 100
  const margins = marginsOf(setup)
  const [top, right, bottom, left] = margins
  const track = useRef<HTMLDivElement>(null)

  // The paragraph at the cursor, re-measured when the selection, the document, the page or the zoom change.
  const [para, setPara] = useState<Para | null>(null)
  const measure = useCallback(() => setPara(measureParagraph(editor, zoom)), [editor, zoom])
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    schedule()
    editor.on('selectionUpdate', schedule)
    editor.on('update', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('selectionUpdate', schedule)
      editor.off('update', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [editor, measure, setup])

  // A handle being dragged with the pointer shows at the pointer, and commits on release.
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null)

  const setMargins = (next: [number, number, number, number]) => setPageSetup(session, { margins: 'custom', customMargins: next })
  const setParagraph = (change: Parameters<Editor['commands']['setParagraphFormat']>[0]) => editor.chain().setParagraphFormat(change).run()
  const round = (pt: number) => Math.round(pt * 10) / 10

  type Handle = {
    id: string
    name: string
    x: number
    min: number
    max: number
    /** What the handle's position means, for assistive technology. */
    text: string
    commit: (x: number) => void
    className: string
    shape: 'down' | 'up' | 'square' | 'bar'
  }

  const textLeft = left
  const textRight = pageWidth - right
  const handles: Handle[] = [
    {
      id: 'margin-left',
      name: 'Left margin',
      x: left,
      min: 0,
      max: Math.min(MAX_MARGIN, textRight - MIN_TEXT),
      text: label(left, unit),
      commit: (x) => setMargins([top, right, bottom, x]),
      className: 'ruler-margin',
      shape: 'bar',
    },
    {
      id: 'margin-right',
      name: 'Right margin',
      x: textRight,
      min: Math.max(textLeft + MIN_TEXT, pageWidth - MAX_MARGIN),
      max: pageWidth,
      text: label(right, unit),
      commit: (x) => setMargins([top, pageWidth - x, bottom, left]),
      className: 'ruler-margin',
      shape: 'bar',
    },
  ]
  if (para) {
    const firstX = para.naturalLeft + (para.left + para.first) * PX_PER_PT
    const leftX = para.naturalLeft + para.left * PX_PER_PT
    const rightX = para.naturalRight - para.right * PX_PER_PT
    const lo = textLeft
    handles.push(
      {
        id: 'first-line',
        name: 'First line indent',
        x: firstX,
        min: lo,
        max: rightX - 12,
        text: `${label(firstX - textLeft, unit)} from the left margin`,
        commit: (x) => setParagraph({ indentFirstLine: round((x - leftX) / PX_PER_PT) }),
        className: 'ruler-indent first',
        shape: 'down',
      },
      {
        id: 'hanging',
        name: 'Hanging indent',
        x: leftX,
        min: lo,
        max: rightX - 12,
        text: `${label(leftX - textLeft, unit)} from the left margin`,
        // The first line stays where it is: moving the hanging indent changes how far the rest hangs.
        commit: (x) => {
          const delta = (x - leftX) / PX_PER_PT
          setParagraph({ indentLeft: round(para.left + delta), indentFirstLine: round(para.first - delta) })
        },
        className: 'ruler-indent hanging',
        shape: 'up',
      },
      {
        id: 'left-indent',
        name: 'Left indent',
        x: leftX,
        min: lo,
        max: rightX - 12,
        text: `${label(leftX - textLeft, unit)} from the left margin`,
        // First line and the rest move together.
        commit: (x) => setParagraph({ indentLeft: round(para.left + (x - leftX) / PX_PER_PT) }),
        className: 'ruler-indent left',
        shape: 'square',
      },
      {
        id: 'right-indent',
        name: 'Right indent',
        x: rightX,
        min: Math.max(leftX, firstX) + 12,
        max: para.naturalRight,
        text: `${label(para.naturalRight - rightX, unit)} from the right margin`,
        commit: (x) => setParagraph({ indentRight: Math.max(0, round((para.naturalRight - x) / PX_PER_PT)) }),
        className: 'ruler-indent right',
        shape: 'up',
      },
    )
  }

  const clamp = (h: Handle, x: number) => Math.min(h.max, Math.max(h.min, x))
  /** Snaps to the ruler's small step (1 mm, 1/16 in), so what is dragged lands on a round value. */
  const snap = (h: Handle, x: number) => (h.id.startsWith('margin') ? Math.round(x / stepPx(unit)) * stepPx(unit) : x)

  const pointerX = (event: PointerEvent) => {
    const rect = track.current?.getBoundingClientRect()
    return rect ? (event.clientX - rect.left) / scale : 0
  }

  const onPointerDown = (h: Handle) => (event: PointerEvent<HTMLElement>) => {
    if (!editable || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    setDrag({ id: h.id, x: clamp(h, pointerX(event)) })
  }
  const onPointerMove = (h: Handle) => (event: PointerEvent<HTMLElement>) => {
    if (drag?.id === h.id) setDrag({ id: h.id, x: clamp(h, pointerX(event)) })
  }
  const onPointerUp = (h: Handle) => (event: PointerEvent<HTMLElement>) => {
    if (drag?.id !== h.id) return
    const x = snap(h, clamp(h, pointerX(event)))
    setDrag(null)
    if (Math.abs(x - h.x) > 0.5) h.commit(x)
    // Back to typing where you were.
    editor.commands.focus()
  }
  const onKeyDown = (h: Handle) => (event: KeyboardEvent<HTMLElement>) => {
    if (!editable) return
    const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (direction === undefined) return
    event.preventDefault()
    const x = clamp(h, h.x + direction * stepPx(unit) * (event.shiftKey ? 5 : 1))
    if (x !== h.x) h.commit(snap(h, x))
  }

  const ticks = (() => {
    const out: { x: number; size: 'minor' | 'mid' | 'major'; text?: string }[] = []
    const per = unitPx(unit)
    const subdivisions = unit === 'cm' ? 4 : 8
    // Numbers count from the left margin, as in Word: the margin area has them too, counting the other way.
    const first = Math.ceil(-left / per) * subdivisions
    const last = Math.floor((pageWidth - left) / per) * subdivisions
    for (let i = first; i <= last; i++) {
      const x = left + (i / subdivisions) * per
      const whole = i % subdivisions === 0
      const size = whole ? 'major' : i % (subdivisions / 2) === 0 ? 'mid' : 'minor'
      out.push({ x, size, text: whole && i !== 0 ? String(Math.abs(i / subdivisions)) : undefined })
    }
    return out
  })()

  const live = (h: Handle) => (drag?.id === h.id ? clamp(h, drag.x) : h.x)
  const marginLeftX = drag?.id === 'margin-left' ? clamp(handles[0], drag.x) : left
  const marginRightX = drag?.id === 'margin-right' ? clamp(handles[1], drag.x) : textRight

  return (
    <div className="ruler-bar" style={{ '--ruler-width': `${pageWidth * scale}px` } as CSSProperties}>
      <div className="ruler" role="group" aria-label="Ruler" ref={track} style={{ height: HEIGHT }}>
        <svg className="ruler-scale" width={pageWidth * scale} height={HEIGHT} aria-hidden>
          <rect className="ruler-text-area" x={marginLeftX * scale} y={10} width={Math.max(0, marginRightX - marginLeftX) * scale} height={10} />
          {ticks.map(({ x, size, text }) => (
            <g key={x}>
              {!text && <line
                className={`ruler-tick ${size}`}
                x1={x * scale}
                x2={x * scale}
                y1={size === 'major' ? 11 : size === 'mid' ? 13 : 14.5}
                y2={size === 'major' ? 19 : size === 'mid' ? 17 : 15.5}
              />}
              {text && (
                <text className="ruler-number" x={x * scale} y={18} textAnchor="middle">
                  {text}
                </text>
              )}
            </g>
          ))}
        </svg>
        {handles.map((h) => {
          const x = live(h) * scale
          const disabled = !editable
          const center = drag?.id === h.id
          return (
            <div
              key={h.id}
              className={`ruler-handle ${h.className}${center ? ' dragging' : ''}`}
              role="slider"
              tabIndex={0}
              aria-label={h.name}
              aria-valuemin={Math.round((h.min / unitPx(unit)) * 100) / 100}
              aria-valuemax={Math.round((h.max / unitPx(unit)) * 100) / 100}
              aria-valuenow={Math.round((live(h) / unitPx(unit)) * 100) / 100}
              aria-valuetext={drag?.id === h.id ? label(live(h), unit) : h.text}
              aria-disabled={disabled || undefined}
              title={`${h.name}: ${h.text}`}
              style={{ left: x }}
              onPointerDown={onPointerDown(h)}
              onPointerMove={onPointerMove(h)}
              onPointerUp={onPointerUp(h)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={onKeyDown(h)}
            >
              <Shape shape={h.shape} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Shape({ shape }: { shape: 'down' | 'up' | 'square' | 'bar' }) {
  switch (shape) {
    case 'down':
      return (
        <svg width="11" height="10" viewBox="0 0 11 10" aria-hidden>
          <polygon points="0.5,0.5 10.5,0.5 10.5,4 5.5,9.5 0.5,4" />
        </svg>
      )
    case 'up':
      return (
        <svg width="11" height="10" viewBox="0 0 11 10" aria-hidden>
          <polygon points="5.5,0.5 10.5,6 10.5,9.5 0.5,9.5 0.5,6" />
        </svg>
      )
    case 'square':
      return (
        <svg width="11" height="5" viewBox="0 0 11 5" aria-hidden>
          <rect x="0.5" y="0.5" width="10" height="4" />
        </svg>
      )
    default:
      return <span className="ruler-bar-grip" aria-hidden />
  }
}
