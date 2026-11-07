import { describe, expect, test } from 'bun:test'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { Window } from 'happy-dom'
import { documentExtensions, lengthToPt } from '../src/editor/schema.ts'

const schema = getSchema(Object.values(documentExtensions()))
const window = new Window()

/** Parses pasted HTML with the document's schema, as the editor does. */
function paste(html: string) {
  window.document.body.innerHTML = html
  return PMDOMParser.fromSchema(schema).parse(window.document.body as unknown as globalThis.Node)
}

describe('paragraph attributes', () => {
  test('pasted lengths convert to pt', () => {
    expect(lengthToPt('12pt')).toBe(12)
    expect(lengthToPt('16px')).toBe(12)
    expect(lengthToPt('1in')).toBe(72)
    expect(lengthToPt('1em')).toBeNull()
  })

  test('sane pasted values are kept', () => {
    const p = paste('<p style="line-height: 1.5; margin-top: 6pt; margin-bottom: 12pt; margin-left: 36pt; text-indent: -18pt">x</p>').firstChild!
    expect(p.attrs).toMatchObject({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, indentLeft: 36, indentFirstLine: -18 })
  })

  test('absurd pasted values are clamped when parsed, and again when rendered (editor and PDF)', () => {
    const doc = paste('<p style="margin-left: -9999pt; margin-top: 1000pt; margin-bottom: 99999pt; margin-right: 99999pt; text-indent: -500pt; line-height: 99">x</p>')
    expect(doc.firstChild!.attrs).toMatchObject({ indentLeft: -72, spaceBefore: 144, spaceAfter: 144, indentRight: 432, indentFirstLine: -72, lineHeight: 10 })
    // A document stored before the clamp (or written by another client) is clamped on the way out.
    const stored = schema.nodes.paragraph.create({ indentLeft: -9999, spaceBefore: 1000 })
    const p = window.document.createElement('div')
    DOMSerializer.fromSchema(schema).serializeFragment(schema.nodes.doc.create(null, [stored]).content, { document: window.document as unknown as globalThis.Document }, p as unknown as HTMLElement)
    const style = (p.firstElementChild as unknown as HTMLElement).style
    expect(style.marginLeft).toBe('-72pt')
    expect(style.marginTop).toBe('144pt')
  })
})
