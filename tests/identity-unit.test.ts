/** Unit tests for the client's identity helpers (`src/identity.ts`): Caret label, colour, share rules. */
import { describe, expect, test } from 'bun:test'
import { isValidEmail as serverIsValidEmail, MAX_SHARES as SERVER_MAX_SHARES } from '../server/roles.ts'
import { colorFor, initialOf, isValidEmail, localPart, MAX_SHARES, presenceLabel, USER_COLORS } from '../src/identity.ts'

describe('localPart', () => {
  test('is the text before the @', () => {
    expect(localPart('alice@example.com')).toBe('alice')
    expect(localPart('first.last+tag@example.com')).toBe('first.last+tag')
    expect(localPart('dev@localhost')).toBe('dev')
  })

  test('falls back to the whole string without a usable @', () => {
    expect(localPart('no-at-sign')).toBe('no-at-sign')
    expect(localPart('@example.com')).toBe('@example.com')
  })
})

describe('colorFor', () => {
  test('is one of the palette colours and stable', () => {
    const color = colorFor('alice@example.com')
    expect(USER_COLORS).toContain(color)
    expect(colorFor('alice@example.com')).toBe(color)
  })

  test('ignores case and surrounding spaces, like the User ID', () => {
    expect(colorFor('  Alice@Example.COM ')).toBe(colorFor('alice@example.com'))
  })

  test('spreads users over the palette', () => {
    const used = new Set(Array.from({ length: 64 }, (_, i) => colorFor(`user${i}@example.com`)))
    expect(used.size).toBeGreaterThanOrEqual(USER_COLORS.length - 1)
  })
})

describe('initialOf', () => {
  test('is the upper-cased first letter of the local part', () => {
    expect(initialOf('bob@example.com')).toBe('B')
    expect(initialOf('')).toBe('?')
  })
})

describe('presenceLabel', () => {
  test('follows the email when a client sends one, whatever its name', () => {
    expect(presenceLabel({ email: 'bob@example.com', name: 'Anonymous Otter' })).toBe('bob')
  })

  test('falls back to the name, then to nothing, and ignores non-strings', () => {
    expect(presenceLabel({ name: 'Old client' })).toBe('Old client')
    expect(presenceLabel({ email: 42, name: { evil: true } })).toBe('')
    expect(presenceLabel(undefined)).toBe('')
  })
})

describe('share rules', () => {
  test('are the server’s own', () => {
    expect(isValidEmail).toBe(serverIsValidEmail)
    expect(MAX_SHARES).toBe(SERVER_MAX_SHARES)
  })
})
