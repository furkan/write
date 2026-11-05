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

/**
 * The share dialog's client-side check, the same rule as the server's `isValidEmail`
 * (`server/roles.ts`): one `@`, no whitespace or address-list punctuation, at most 254 characters.
 */
export const isValidEmail = (email: string) =>
  email.length <= 254 && /^[^\s@,;:<>()[\]"'\\/]+@[^\s@,;:<>()[\]"'\\/]+$/.test(email)

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
