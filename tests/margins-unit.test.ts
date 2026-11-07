import { describe, expect, test } from 'bun:test'
import { IN, marginsOf, marginUnit, MAX_MARGIN, PAPER_SIZES, readPageSetup, validateMargins } from '../src/editor/paper.ts'

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

describe('custom margins on other paper', () => {
  test('large custom margins are scaled down so an inch of text is left', () => {
    const big = [3 * IN, 3 * IN, 3 * IN, 3 * IN] as const
    // On A4 they fit (A4 is 8.27 in wide): untouched.
    expect([...marginsOf({ size: 'a4', orientation: 'portrait', margins: 'custom', customMargins: big })]).toEqual([...big])
    // On A5 (5.83 in wide, 8.27 in high) the sides are scaled to leave exactly an inch; top and bottom still fit.
    const a5 = marginsOf({ size: 'a5', orientation: 'portrait', margins: 'custom', customMargins: big })
    expect(a5[3] + a5[1]).toBeCloseTo(PAPER_SIZES.a5.width - IN, 5)
    expect(a5[3]).toBeCloseTo(a5[1], 5)
    expect(a5[0]).toBe(3 * IN)
    // Landscape A5 is 5.83 in high: top and bottom are scaled instead.
    const land = marginsOf({ size: 'a5', orientation: 'landscape', margins: 'custom', customMargins: big })
    expect(land[0] + land[2]).toBeCloseTo(PAPER_SIZES.a5.width - IN, 5)
    // Unequal margins keep their proportion.
    const uneven = marginsOf({ size: 'a5', orientation: 'portrait', margins: 'custom', customMargins: [IN, 3 * IN, IN, IN] })
    expect(uneven[1] / uneven[3]).toBeCloseTo(3, 5)
    // Presets are never changed.
    expect([...marginsOf({ size: 'a5', orientation: 'portrait', margins: 'wide' })]).toEqual([IN, 2 * IN, IN, 2 * IN])
  })
})
