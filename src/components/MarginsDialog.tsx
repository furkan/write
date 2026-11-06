import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { marginsOf, setPageSetup, type PageSetup } from '../editor/page-setup'
import { marginUnit, PX_PER_UNIT, validateMargins } from '../editor/paper'
import type { Session } from '../editor/collab'

type Field = 'top' | 'bottom' | 'left' | 'right'
const FIELDS: { name: Field; label: string; index: number }[] = [
  { name: 'top', label: 'Top', index: 0 },
  { name: 'bottom', label: 'Bottom', index: 2 },
  { name: 'left', label: 'Left', index: 3 },
  { name: 'right', label: 'Right', index: 1 },
]

const round = (n: number) => String(Math.round(n * 100) / 100)

/**
 * Layout > Margins > Custom margins…: Top, Bottom, Left and Right in the paper's unit, prefilled
 * with the current margins. OK saves through the page setup (shared, one undo step).
 */
export function MarginsDialog({ session, setup, onClose }: { session: Session; setup: PageSetup; onClose: () => void }) {
  const unit = marginUnit(setup.size)
  const perUnit = PX_PER_UNIT[unit]
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const errorId = useId()
  const current = marginsOf(setup)
  const [values, setValues] = useState<Record<Field, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.name, round(current[f.index] / perUnit)])) as Record<Field, string>,
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const parsed = FIELDS.map((f) => {
    const text = values[f.name].trim()
    const n = Number(text)
    return text !== '' && Number.isFinite(n) ? n * perUnit : null
  })
  // Same order as the margins: top, right, bottom, left.
  const margins = [parsed[0], parsed[3], parsed[1], parsed[2]]
  const errors = validateMargins(setup, margins, unit)
  const messages = Object.values(errors)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (messages.length) return
    setPageSetup(session, { margins: 'custom', customMargins: margins as unknown as [number, number, number, number] })
    dialogRef.current?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      className="share-dialog margins-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialogRef.current?.close()}
    >
      <form className="share-content" onSubmit={submit} noValidate>
        <h2 id={titleId} className="share-title">
          Custom margins
        </h2>
        <div className="margins-grid">
          {FIELDS.map((f) => (
            <label key={f.name}>
              <span>
                {f.label} ({unit})
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={unit === 'cm' ? 0.1 : 0.05}
                min={0}
                value={values[f.name]}
                autoFocus={f.name === 'top'}
                aria-invalid={errors[f.name] ? true : undefined}
                aria-describedby={messages.length ? errorId : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div id={errorId} aria-live="polite">
          {messages.map((message) => (
            <p key={message} className="share-error">
              {message}
            </p>
          ))}
        </div>
        <div className="share-footer">
          <span />
          <span className="closed-actions">
            <button type="button" className="secondary-button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={messages.length > 0}>
              OK
            </button>
          </span>
        </div>
      </form>
    </dialog>
  )
}
