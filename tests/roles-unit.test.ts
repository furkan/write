/** Unit tests for role resolution and share validation (`server/roles.ts`), without a server. */
import { describe, expect, test } from 'bun:test'
import { isValidEmail, roleOf, sanitizeShares, statusFor, type Ownership } from '../server/roles.ts'

const doc = (extra: Partial<Ownership> = {}): Ownership => ({
  owner: 'alice@x.com',
  shares: { 'bob@x.com': 'editor', 'carol@x.com': 'viewer' },
  ...extra,
})

describe('roleOf', () => {
  test('owner, editor, viewer and stranger', () => {
    expect(roleOf(doc(), 'alice@x.com')).toBe('owner')
    expect(roleOf(doc(), 'bob@x.com')).toBe('editor')
    expect(roleOf(doc(), 'carol@x.com')).toBe('viewer')
    expect(roleOf(doc(), 'mallory@x.com')).toBeNull()
  })

  test('a missing document is no access', () => {
    expect(roleOf(undefined, 'alice@x.com')).toBeNull()
  })

  test('a trashed document is open to nobody, not even its owner', () => {
    const trashed = doc({ trashedAt: 1 })
    for (const email of ['alice@x.com', 'bob@x.com', 'carol@x.com', 'mallory@x.com']) {
      expect(roleOf(trashed, email)).toBeNull()
    }
  })

  test('built-in object keys are never shares', () => {
    for (const email of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(roleOf(doc(), email)).toBeNull()
    }
  })

  test('a share with an unknown role grants nothing', () => {
    const odd = { owner: 'alice@x.com', shares: { 'bob@x.com': 'owner' } } as unknown as Ownership
    expect(roleOf(odd, 'bob@x.com')).toBeNull()
  })
})

describe('statusFor', () => {
  const none = { access: 'none', trashed: false, deleted: false } as const

  test('open document', () => {
    expect(statusFor(doc(), undefined, 'alice@x.com')).toEqual({ access: 'owner', trashed: false, deleted: false })
    expect(statusFor(doc(), undefined, 'bob@x.com')).toEqual({ access: 'editor', trashed: false, deleted: false })
    expect(statusFor(doc(), undefined, 'carol@x.com')).toEqual({ access: 'viewer', trashed: false, deleted: false })
    expect(statusFor(doc(), undefined, 'mallory@x.com')).toEqual(none)
  })

  test('trashed: the owner may restore, collaborators learn why, strangers learn nothing', () => {
    const trashed = doc({ trashedAt: 1 })
    expect(statusFor(trashed, undefined, 'alice@x.com')).toEqual({ access: 'owner', trashed: true, deleted: false })
    expect(statusFor(trashed, undefined, 'bob@x.com')).toEqual({ access: 'none', trashed: true, deleted: false })
    expect(statusFor(trashed, undefined, 'carol@x.com')).toEqual({ access: 'none', trashed: true, deleted: false })
    expect(statusFor(trashed, undefined, 'mallory@x.com')).toEqual(none)
  })

  test('deleted forever: only the former owner is told', () => {
    expect(statusFor(undefined, 'alice@x.com', 'alice@x.com')).toEqual({ access: 'none', trashed: false, deleted: true })
    expect(statusFor(undefined, 'alice@x.com', 'bob@x.com')).toEqual(none)
    // A version-1 tombstone with no known owner.
    expect(statusFor(undefined, '', '')).toEqual(none)
  })

  test('never existed', () => {
    expect(statusFor(undefined, undefined, 'alice@x.com')).toEqual(none)
  })
})

describe('isValidEmail', () => {
  test('accepts ordinary and Dev mode addresses', () => {
    for (const email of ['bob@x.com', 'first.last+tag@sub.example.co.uk', 'dev@localhost']) {
      expect(isValidEmail(email)).toBe(true)
    }
  })

  test('rejects malformed addresses', () => {
    for (const email of ['', 'bob', '@x.com', 'bob@', 'a@b@c', 'bob @x.com', 'a,b@x.com', 'bob@x.com;c@x.com', '<b@x.com>', `${'a'.repeat(250)}@x.com`]) {
      expect(isValidEmail(email)).toBe(false)
    }
  })
})

describe('sanitizeShares', () => {
  test('lowercases, drops bad entries and the owner', () => {
    expect(
      sanitizeShares(
        { 'Bob@X.com': 'editor', 'carol@x.com': 'viewer', 'alice@x.com': 'editor', 'bad': 'viewer', 'dan@x.com': 'owner' },
        'alice@x.com',
      ),
    ).toEqual({ 'bob@x.com': 'editor', 'carol@x.com': 'viewer' })
  })

  test('anything but an object is no shares', () => {
    expect(sanitizeShares(undefined, 'a@x.com')).toEqual({})
    expect(sanitizeShares(['bob@x.com'], 'a@x.com')).toEqual({})
  })
})
