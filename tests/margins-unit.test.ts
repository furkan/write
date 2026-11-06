import { describe, expect, test } from 'bun:test'
import { IN, marginsOf, marginUnit, MAX_MARGIN, readPageSetup, validateMargins } from '../src/editor/paper.ts'

const meta = (values: Record<string, unknown>) => ({ get: (key: string) => values[key] })

describe('margins', () => {
  test('Moderate is 1 in top and bottom, 0.75 in left and right', () => {
    const setup = readPageSetup(meta({ pageMargins: 'moderate' }))
    expect(setup.margins).toBe('moderate')
    expect(marginsOf(setup)).toEqual([IN, 0.75 * IN, IN, 0.75 * IN])
  })

  test('custom margins come from the stored values, and read as Normal without valid ones', () => {
    const setup = readPageSetup(meta({ pageMargins: 'custom', pageMarginValues: '48,60,72.5,96' }))
    expect(setup.margins).toBe('custom')
    expect([...marginsOf(setup)]).toEqual([48, 60, 72.5, 96])
    for (const bad of [undefined, 'x', '1,2,3', '1,2,3,-4', `1,2,3,${MAX_MARGIN + 1}`]) {
      const fallback = readPageSetup(meta({ pageMargins: 'custom', pageMarginValues: bad }))
      expect(fallback.margins).toBe('normal')
      expect([...marginsOf(fallback)]).toEqual([IN, IN, IN, IN])
    }
  })

  test('the unit follows the paper', () => {
    expect([marginUnit('a4'), marginUnit('a5'), marginUnit('letter'), marginUnit('legal')]).toEqual(['cm', 'cm', 'in', 'in'])
  })

  test('validation: 0 to 3 in each, at least an inch of text each way', () => {
    const page = { size: 'letter', orientation: 'portrait' } as const
    expect(validateMargins(page, [IN, IN, IN, IN])).toEqual({})
    expect(validateMargins(page, [0, 0, 0, 0])).toEqual({})
    expect(Object.keys(validateMargins(page, [-1, IN, IN, IN]))).toEqual(['top'])
    expect(Object.keys(validateMargins(page, [IN, IN, IN, 3 * IN + 1]))).toEqual(['left'])
    expect(validateMargins(page, [null, IN, IN, IN]).top).toContain('Enter a number')
    const a5 = { size: 'a5', orientation: 'portrait' } as const
    expect(Object.keys(validateMargins(a5, [IN, 3 * IN, IN, 3 * IN]))).toEqual(['width'])
    expect(Object.keys(validateMargins({ size: 'a5', orientation: 'landscape' }, [3 * IN, IN, 3 * IN, IN]))).toEqual(['height'])
    expect(validateMargins({ size: 'a4', orientation: 'portrait' }, [3 * IN + 1, IN, IN, IN]).top).toContain('0 and 7.62 cm')
  })
})
