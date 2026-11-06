import { expect, test } from 'bun:test'
import { common, createLowlight } from 'lowlight'
import { COMMON_LANGUAGES } from '../src/editor/schema.ts'

test('COMMON_LANGUAGES matches the languages lowlight loads', () => {
  expect([...COMMON_LANGUAGES]).toEqual(createLowlight(common).listLanguages())
})
