import { colorFor, initialOf } from '../identity'

/** A round initial in the User's colour (the same colour as their caret). */
export function Avatar({ email }: { email: string }) {
  return (
    <span className="account-avatar" style={{ background: colorFor(email) }} aria-hidden>
      {initialOf(email)}
    </span>
  )
}
