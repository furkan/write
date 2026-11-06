import { Extension } from '@tiptap/core'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Emoji, gitHubEmojis } from '@tiptap/extension-emoji'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { Mention } from '@tiptap/extension-mention'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import { TableOfContents } from '@tiptap/extension-table-of-contents'
import { TextAlign } from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { UniqueID } from '@tiptap/extension-unique-id'
import { Youtube } from '@tiptap/extension-youtube'
import { Plugin, type PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { createLowlight } from 'lowlight'
import { Callout } from './extensions/callout.ts'
import { Spoiler } from './extensions/spoiler.ts'

/**
 * The document's schema: every node, mark and attribute the editor stores in the Y.Doc, configured
 * once for the editor (`extensions.ts`, which adds suggestions, node views and click handlers with
 * `.configure()`/`.extend()`) and for the server, which renders the stored document to HTML for
 * the PDF export (`server/pdf-html.ts`). So no React and no DOM in this module or what it imports.
 */

/** The browser (as opposed to the server rendering the PDF, which has no global `document`). */
const IN_BROWSER = typeof document !== 'undefined'

type Lowlight = ReturnType<typeof createLowlight>

// highlight.js's `common` languages are ~140 kB, so the browser loads them after the editor
// opens: a code block shows plain until they arrive, then `rehighlight` colours it. Until then
// this stands in for the real lowlight, which `loadLanguages` swaps in.
let real: Lowlight | null = null
const EMPTY_ROOT = { type: 'root', children: [] } as ReturnType<Lowlight['highlight']>
// What `createLowlight(common).listLanguages()` returns, so the Code tab can list them at once.
export const COMMON_LANGUAGES = [
  'arduino', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'graphql', 'ini', 'java', 'javascript',
  'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown', 'objectivec', 'perl', 'php', 'php-template',
  'plaintext', 'python', 'python-repl', 'r', 'ruby', 'rust', 'scss', 'shell', 'sql', 'swift', 'typescript',
  'vbnet', 'wasm', 'xml', 'yaml',
]

export const lowlight = {
  highlight: (language: string, value: string, options?: Parameters<Lowlight['highlight']>[2]) =>
    real ? real.highlight(language, value, options) : EMPTY_ROOT,
  highlightAuto: (value: string, options?: Parameters<Lowlight['highlightAuto']>[1]) =>
    real ? real.highlightAuto(value, options) : EMPTY_ROOT,
  listLanguages: () => (real ? real.listLanguages() : COMMON_LANGUAGES),
  registered: (language: string) => (real ? real.registered(language) : false),
} as unknown as Lowlight

let loading: Promise<void> | undefined
/** Loads the `common` languages (once). The server awaits this at import, below. */
export function loadLanguages() {
  loading ??= import('lowlight').then(({ common, createLowlight }) => {
    real = createLowlight(common)
  })
  return loading
}
// The PDF render is synchronous, so the server has the languages before anything else runs.
if (!IN_BROWSER) await loadLanguages()

// A code block's colours are decorations computed from the document, which only recompute when
// it changes. Rebuilding the plugin (a new instance, after removing the old one so ProseMirror
// doesn't keep its state) colours blocks already on the page once the languages have loaded.
function rehighlight(editor: Editor) {
  if (editor.isDestroyed) return
  const old = editor.state.plugins.find((p) => (p.spec.key as { key?: string } | undefined)?.key?.startsWith('lowlight$'))
  if (!old) return
  editor.unregisterPlugin(old.spec.key as PluginKey)
  editor.registerPlugin(new Plugin(old.spec))
}

const CodeBlock = CodeBlockLowlight.extend({
  onCreate() {
    if (real) return
    void loadLanguages().then(() => rehighlight(this.editor))
  },
})

/*
 * Paragraph formatting, like Word's Paragraph dialog: line spacing (a multiple of the font size),
 * space before and after (pt) and indents (pt; the first line's may be negative: a hanging
 * indent). Attributes of paragraphs and headings, `null` meaning the style's own value, stored
 * in the Y.Doc like any other attribute and rendered as inline style (so the PDF has them too).
 */
export const PARAGRAPH_TYPES = ['paragraph', 'heading']

export type ParagraphFormat = {
  lineHeight: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  indentLeft: number | null
  indentRight: number | null
  indentFirstLine: number | null
}

const UNITS_PER_PT: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 }

/** A CSS length as points (pt, px, in, cm and mm; what Word and Google Docs paste), else `null`. */
export function lengthToPt(value: string | null | undefined): number | null {
  const match = /^(-?\d*\.?\d+)(pt|px|in|cm|mm)$/i.exec((value ?? '').trim())
  if (!match) return null
  const pt = Number(match[1]) * UNITS_PER_PT[match[2].toLowerCase()]
  return Number.isFinite(pt) ? Math.round(pt * 10) / 10 : null
}

const finite = (min: number, max: number) => (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : null
}

type Field = { attr: keyof ParagraphFormat; css: string; unit: string; read: (el: HTMLElement) => number | null; clean: (v: unknown) => number | null }

const FIELDS: Field[] = [
  {
    attr: 'lineHeight',
    css: 'line-height',
    unit: '',
    // Only a plain multiple: a length (`18pt`) or `normal` is the pasted document's own.
    read: (el) => (/^\d*\.?\d+$/.test(el.style.lineHeight) ? Number(el.style.lineHeight) : null),
    clean: finite(0.5, 10),
  },
  { attr: 'spaceBefore', css: 'margin-top', unit: 'pt', read: (el) => lengthToPt(el.style.marginTop), clean: finite(0, 1584) },
  { attr: 'spaceAfter', css: 'margin-bottom', unit: 'pt', read: (el) => lengthToPt(el.style.marginBottom), clean: finite(0, 1584) },
  { attr: 'indentLeft', css: 'margin-left', unit: 'pt', read: (el) => lengthToPt(el.style.marginLeft), clean: finite(-1584, 1584) },
  { attr: 'indentRight', css: 'margin-right', unit: 'pt', read: (el) => lengthToPt(el.style.marginRight), clean: finite(-1584, 1584) },
  { attr: 'indentFirstLine', css: 'text-indent', unit: 'pt', read: (el) => lengthToPt(el.style.textIndent), clean: finite(-1584, 1584) },
]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Sets (or, with `null`, resets) paragraph formatting on every paragraph and heading in the selection. */
      setParagraphFormat: (change: Partial<ParagraphFormat>) => ReturnType
    }
  }
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: PARAGRAPH_TYPES,
        attributes: Object.fromEntries(
          FIELDS.map(({ attr, css, unit, read, clean }) => [
            attr,
            {
              default: null,
              parseHTML: (element: HTMLElement) => read(element),
              renderHTML: (attributes: Record<string, unknown>) => {
                const value = clean(attributes[attr])
                return value === null ? {} : { style: `${css}: ${value}${unit}` }
              },
            },
          ]),
        ),
      },
    ]
  },

  addCommands() {
    return {
      setParagraphFormat:
        (change) =>
        ({ tr, state }) => {
          const clean: Record<string, number | null> = {}
          for (const field of FIELDS) if (field.attr in change) clean[field.attr] = field.clean(change[field.attr])
          const { from, to } = state.selection
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!PARAGRAPH_TYPES.includes(node.type.name)) return true
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...clean })
            return false
          })
          return true
        },
    }
  },
})

export const KATEX_OPTIONS = { throwOnError: false }

// The YouTube iframe below the fold needn't load with the page. Not images: they measure 0px until
// loaded, which shifts page breaks, and lazy saves nothing for base64 images. Browser only, so a
// print/PDF render isn't left with unloaded embeds.
const LAZY_IFRAME = IN_BROWSER ? { loading: 'lazy' } : {}

export function documentExtensions() {
  return {
    starterKit: StarterKit.configure({
      // Yjs has its own history; the regular undo/redo would fight it.
      undoRedo: false,
      // Replaced by CodeBlockLowlight below.
      codeBlock: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    textAlign: TextAlign.configure({ types: ['heading', 'paragraph'] }),
    paragraphFormat: ParagraphFormat,
    highlight: Highlight.configure({ multicolor: true }),
    textStyle: TextStyleKit,
    subscript: Subscript,
    superscript: Superscript,
    taskList: TaskList,
    taskItem: TaskItem.configure({ nested: true }),
    image: Image.configure({
      allowBase64: true,
      resize: {
        enabled: true,
        directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        minWidth: 80,
        minHeight: 40,
        alwaysPreserveAspectRatio: true,
      },
    }),
    table: TableKit.configure({ table: { resizable: true } }),
    details: Details.configure({ persist: true }),
    detailsSummary: DetailsSummary,
    detailsContent: DetailsContent,
    youtube: Youtube.configure({ HTMLAttributes: LAZY_IFRAME, nocookie: true, width: 640, height: 360 }),
    emoji: Emoji.configure({ emojis: gitHubEmojis, enableEmoticons: true }),
    uniqueId: UniqueID.configure({
      // TableOfContents already owns the `id` attribute on headings; keep these separate.
      attributeName: 'uid',
      types: ['heading', 'paragraph', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'callout', 'details'],
      // Don't re-assign IDs for changes that came from other collaborators.
      filterTransaction: (transaction) => !isChangeOrigin(transaction),
    }),
    mention: Mention.configure({ HTMLAttributes: { class: 'mention' } }),
    codeBlock: CodeBlock.configure({ lowlight, defaultLanguage: 'plaintext' }),
    tableOfContents: TableOfContents,
    callout: Callout,
    spoiler: Spoiler,
    mathematics: Mathematics.configure({ katexOptions: KATEX_OPTIONS }),
  }
}
