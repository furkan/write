/**
 * Who may do what with a document: the Owner, the Shares (`email → editor|viewer`) and the
 * caller's Role. Pure functions over an index entry, so every REST handler and the
 * collaboration server resolve roles the same way (see GLOSSARY.md and ADR 0003).
 */

export type ShareRole = 'editor' | 'viewer'
/** A user's role on a document; `owner` is never granted by a share. */
export type Role = 'owner' | ShareRole
/** What `GET /api/docs/:id/status` reports: a role, or `none` for No access. */
export type Access = Role | 'none'
/** Shares keyed by lowercased email. */
export type Shares = Record<string, ShareRole>

/** The parts of an index entry that decide access. */
export type Ownership = { owner: string; shares: Shares; trashedAt?: number }

/** At most this many shares per document. */
export const MAX_SHARES = 50

export const isShareRole = (value: unknown): value is ShareRole => value === 'editor' || value === 'viewer'

/**
 * A simple email check for share targets: one `@`, something on each side, no spaces or
 * address-list punctuation. The domain may lack a dot so Dev mode identities like
 * `dev@localhost` can be shared with. Pass emails through `normalizeEmail` first.
 */
export const isValidEmail = (email: string) =>
  email.length <= 254 && /^[^\s@,;:<>()[\]"'\\/]+@[^\s@,;:<>()[\]"'\\/]+$/.test(email)

/** The share `email` has on the entry, whether or not the document is in the Trash. */
export function shareOf(entry: Ownership, email: string): ShareRole | null {
  if (!Object.hasOwn(entry.shares, email)) return null
  const role = entry.shares[email]
  return isShareRole(role) ? role : null
}

/**
 * The caller's role on a document they can open now, or null for No access. A trashed
 * document is open to nobody: its shares are inactive and the owner can only restore it.
 */
export function roleOf(entry: Ownership | undefined, email: string): Role | null {
  if (!entry || entry.trashedAt !== undefined) return null
  if (entry.owner === email) return 'owner'
  return shareOf(entry, email)
}

/** Editing content and renaming. */
export const canEdit = (role: Role | null) => role === 'owner' || role === 'editor'

export type DocStatus = { access: Access; trashed: boolean; deleted: boolean }

const NO_ACCESS: DocStatus = { access: 'none', trashed: false, deleted: false }

/**
 * `GET /status`. Anyone without a role gets `none` and nothing more, whether the document never
 * existed, is someone else's or was purged. Only people who had a role learn why it closed:
 * - the owner of a trashed document: `owner`, trashed (they can restore it);
 * - a collaborator on a trashed document: `none`, trashed (their share is inactive);
 * - the former owner of a purged document: `none`, deleted.
 *
 * @param tombstoneOwner Who owned the document, if it was deleted forever.
 */
export function statusFor(entry: Ownership | undefined, tombstoneOwner: string | undefined, email: string): DocStatus {
  if (!entry) return tombstoneOwner && tombstoneOwner === email ? { ...NO_ACCESS, deleted: true } : NO_ACCESS
  const trashed = entry.trashedAt !== undefined
  if (entry.owner === email) return { access: 'owner', trashed, deleted: false }
  const share = shareOf(entry, email)
  if (!share) return NO_ACCESS
  return trashed ? { ...NO_ACCESS, trashed: true } : { access: share, trashed: false, deleted: false }
}

/** Keeps only well-formed shares from an index file (lowercased emails, known roles), never the owner. */
export function sanitizeShares(raw: unknown, owner: string): Shares {
  const shares: Shares = {}
  if (!raw || typeof raw !== 'object') return shares
  for (const [key, role] of Object.entries(raw as Record<string, unknown>)) {
    const email = key.trim().toLowerCase()
    if (isValidEmail(email) && email !== owner && isShareRole(role)) shares[email] = role
  }
  return shares
}
