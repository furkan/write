/**
 * Pure helpers for showing a User (an email) in the UI: the Caret label and its colour.
 * No React or DOM here, so they are unit-tested in `tests/identity-unit.test.ts`.
 */

/** Caret and avatar colours; readable with white text on both themes. */
export const USER_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']

/** The Caret label: the part of the email before the last `@` (the whole string if there is none). */
export function localPart(email: string): string {
  const at = email.lastIndexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

/**
 * A colour derived from the email (FNV-1a), so a user has the same colour on every device and
 * in every document. Case and surrounding spaces don't matter, like the User ID itself.
 */
export function colorFor(email: string): string {
  let hash = 0x811c9dc5
  for (const char of email.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return USER_COLORS[(hash >>> 0) % USER_COLORS.length]
}

/** One letter for an avatar. */
export const initialOf = (email: string) => (localPart(email).trim()[0] ?? '?').toUpperCase()

// The share rules come from the server's own module (pure, no Node imports), so the client's
// checks can't drift from what the server enforces.
export { isValidEmail, MAX_SHARES } from '../server/roles.ts'

/**
 * The Caret label for a presence entry. Presence is client-reported: the label is derived from
 * the sender's `email` when there is one (so it follows the local-part rule whatever `name` a
 * client sends), else its `name`, else empty.
 */
export function presenceLabel(user: { email?: unknown; name?: unknown } | undefined): string {
  if (typeof user?.email === 'string' && user.email) return localPart(user.email)
  return typeof user?.name === 'string' ? user.name : ''
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
