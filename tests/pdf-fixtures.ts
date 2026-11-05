/**
 * Documents for the PDF export tests: one with every node and mark the editor has, and plain
 * paragraphs, as Yjs updates (what the server stores).
 */
import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { PageSetup } from '../src/editor/paper.ts'
import { documentExtensions } from '../src/editor/schema.ts'

type Json = Record<string, unknown>

const schema = getSchema(Object.values(documentExtensions()))

const text = (value: string, marks?: Json[]): Json => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (...content: Json[]): Json => ({ type: 'paragraph', content })
const heading = (level: number, value: string): Json => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const cell = (type: 'tableCell' | 'tableHeader', value: string, attrs: Json = {}): Json => ({
  type,
  attrs,
  content: [p(text(value))],
})

/** A 1×1 red PNG. */
export const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

/** Every node type and mark, with `imageUrl` as an image linked by URL. */
export function everyNodeJson(imageUrl: string): Json {
  return {
    type: 'doc',
    content: [
      heading(1, 'Every node'),
      p(
        text('Bold', [{ type: 'bold' }]),
        text(' italic', [{ type: 'italic' }]),
        text(' underline', [{ type: 'underline' }]),
        text(' strike', [{ type: 'strike' }]),
        text(' code', [{ type: 'code' }]),
        text(' sub', [{ type: 'subscript' }]),
        text(' sup', [{ type: 'superscript' }]),
        text(' highlight', [{ type: 'highlight', attrs: { color: '#bbf7d0' } }]),
        text(' coloured', [{ type: 'textStyle', attrs: { color: '#7c3aed', fontFamily: 'Georgia, serif' } }]),
        text(' spoiler', [{ type: 'spoiler' }]),
        text(' link', [{ type: 'link', attrs: { href: 'https://example.com/' } }]),
        text(' bad link', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        { type: 'hardBreak' },
        text('after a break '),
        { type: 'mention', attrs: { id: 'ada', label: 'Ada Lovelace' } },
        text(' '),
        { type: 'emoji', attrs: { name: 'sparkles' } },
        text(' '),
        { type: 'inlineMath', attrs: { latex: 'e^{i\\pi} + 1 = 0' } },
      ),
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('Centred')] },
      heading(2, 'Lists'),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(text('Bullet'))] }],
      },
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [p(text('Numbered'))] }],
      },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('Done task'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('Open task'))] },
        ],
      },
      { type: 'blockquote', content: [p(text('A quotation'))] },
      { type: 'horizontalRule' },
      heading(2, 'Table'),
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Name', { colwidth: [300] }), cell('tableHeader', 'Value', { colwidth: [900] })] },
          { type: 'tableRow', content: [cell('tableCell', 'Merged', { rowspan: 2 }), cell('tableCell', 'One')] },
          { type: 'tableRow', content: [cell('tableCell', 'Two')] },
          { type: 'tableRow', content: [cell('tableCell', 'Wide cell', { colspan: 2 })] },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [text("const greeting: string = 'hello'\nconsole.log(greeting)")],
      },
      { type: 'blockMath', attrs: { latex: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}' } },
      { type: 'image', attrs: { src: PNG_DATA_URL, alt: 'Embedded', width: 120 } },
      { type: 'image', attrs: { src: imageUrl, alt: 'Linked' } },
      { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
      { type: 'callout', attrs: { variant: 'warning' }, content: [p(text('A warning callout'))] },
      {
        type: 'details',
        attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [text('Toggle summary')] },
          { type: 'detailsContent', content: [p(text('Toggle content'))] },
        ],
      },
      p(text('The end')),
    ],
  }
}

export type Meta = Partial<{ title: string; pageSize: string; pageOrientation: string; pageMargins: string }>

/** A Yjs update for `json` with `meta` (title, page setup). */
export function docState(json: Json, meta: Meta = {}) {
  const doc = prosemirrorJSONToYDoc(schema, json, 'default')
  const map = doc.getMap('meta')
  for (const [key, value] of Object.entries(meta)) map.set(key, value)
  return Y.encodeStateAsUpdate(doc)
}

/** `count` paragraphs of filler text, numbered. */
export function paragraphsJson(count: number, words = 60): Json {
  const filler = Array.from({ length: words }, (_, i) => ['lorem', 'ipsum', 'dolor', 'sit', 'amet'][i % 5]).join(' ')
  return { type: 'doc', content: Array.from({ length: count }, (_, i) => p(text(`Paragraph ${i + 1}. ${filler}`))) }
}

export const pageMeta = (setup: PageSetup): Meta => ({
  pageSize: setup.size,
  pageOrientation: setup.orientation,
  pageMargins: setup.margins,
})
