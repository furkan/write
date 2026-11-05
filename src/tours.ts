import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { mod } from './editor/platform'
import { readStorage, writeStorage } from './editor/storage'

/**
 * Guided tutorial overlays (driver.js). Each step spotlights an element marked
 * with `data-tour="…"`; steps without an element show as a centred card.
 */

const k = (keys: string) => `<kbd>${keys}</kbd>`

export type TourId = 'library' | 'welcome' | 'formatting' | 'blocks' | 'developer' | 'collaboration'

/** `scope` says which page a tour belongs to (its elements only exist there). */
type Tour = { title: string; summary: string; scope: 'library' | 'document'; steps: DriveStep[] }

export const TOURS: Record<TourId, Tour> = {
  library: {
    title: 'Library tour',
    summary: 'Templates, your documents and how to manage them.',
    scope: 'library',
    steps: [
      {
        popover: {
          title: 'Your documents 📚',
          description:
            'This is the library: every shared document on this server. Everything you see here is shared with anyone who can open this page.',
        },
      },
      {
        element: '[data-tour="templates"]',
        popover: {
          title: 'Start a new document',
          description:
            'Pick a blank page or a template. <b>Feature tour</b> is a document that shows off every editor feature.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="search"]',
        popover: {
          title: 'Search',
          description: `Filter by title or content. Press ${k('/')} to jump here.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="doc-list"]',
        popover: {
          title: 'Recent documents',
          description:
            'Sorted by last edit, with a live preview of each one. Use the controls above the list to switch between grid and list view, or to sort by title.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="doc-actions"]',
        popover: {
          title: 'Rename, copy, delete',
          description:
            'Each document’s ⋮ menu can rename it (open editors update live), make a copy, open it in a new tab or move it to the trash.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="trash"]',
        popover: {
          title: 'Trash',
          description:
            'Deleted documents wait here for 30 days. Restore one, or delete it forever. Right after deleting, the <b>Undo</b> button in the message at the bottom brings it back.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="theme"]',
        popover: {
          title: 'Theme',
          description: 'Choose light, dark, or follow your system. Your choice is remembered in this browser.',
          side: 'bottom',
          align: 'end',
        },
      },
    ],
  },

  welcome: {
    title: 'Welcome tour',
    summary: 'The layout and the essentials, in about a minute.',
    scope: 'document',
    steps: [
      {
        popover: {
          title: 'Welcome to Write 👋',
          description:
            'This is a playground for the <b>Tiptap</b> editor, with most of its extensions turned on. Use the arrow keys or the buttons to move through the tour. Press <kbd>Esc</kbd> to leave.',
        },
      },
      {
        element: '[data-tour="title"]',
        popover: {
          title: 'Title',
          description:
            'Click to rename the document. The title syncs live to collaborators and to the library. The ✍️ logo takes you back to all documents.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'The document',
          description:
            'Everything you type is saved and shared live. The demo content shows each feature, so feel free to edit or delete it.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="toolbar"]',
        popover: {
          title: 'Toolbar',
          description:
            'Block types, fonts, marks, colours, alignment, lists and an <b>Insert</b> menu. Hover any button to see its keyboard shortcut. More buttons appear here while you are in a table or code block.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Menus inside the text',
          description: `<ul class="tour-list">
            <li>${k('/')} opens the <b>block menu</b>. Start typing to filter it.</li>
            <li>${k('@')} mentions a person and ${k(':')} inserts an emoji.</li>
            <li><b>Select text</b> to get a formatting bubble.</li>
            <li>An <b>empty line</b> shows quick-insert buttons below it.</li>
            <li>Hover a block and grab ${k('⋮⋮')} on its left to <b>drag it</b> somewhere else.</li>
          </ul>`,
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="toc"]',
        popover: {
          title: 'Table of contents',
          description: 'Built from your headings as you type. Click an entry to jump to it.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="inspector"]',
        popover: {
          title: 'Inspector',
          description:
            'The document as JSON, HTML, Markdown and plain text, updated on every keystroke. Open <b>Events</b> to watch the editor’s event stream.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="status"]',
        popover: {
          title: 'Status bar',
          description:
            'Word and character counts (with a limit), the block your cursor is in, when the local backup was last saved, and the connection status.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="theme"]',
        popover: {
          title: 'Light or dark',
          description: 'Switch the theme here, or let it follow your system setting.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="help"]',
        popover: {
          title: 'More tours',
          description: `Take the other tours or restart this one from here. Press ${k('?')} while the cursor is outside the document to replay this tour.`,
          side: 'bottom',
          align: 'end',
        },
      },
    ],
  },

  formatting: {
    title: 'Formatting & shortcuts',
    summary: 'Marks, Markdown shortcuts, typography and colours.',
    scope: 'document',
    steps: [
      {
        element: '[data-tour="marks"]',
        popover: {
          title: 'Text marks',
          description: `Bold ${k(`${mod}+B`)}, italic ${k(`${mod}+I`)}, underline ${k(`${mod}+U`)}, strike ${k(`${mod}+Shift+S`)}, code ${k(`${mod}+E`)}, subscript ${k(`${mod}+,`)}, superscript ${k(`${mod}+.`)}, link ${k(`${mod}+K`)}, and a custom <b>spoiler</b> mark ${k(`${mod}+Alt+S`)}.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="text-style"]',
        popover: {
          title: 'Headings, fonts and sizes',
          description:
            'H1–H6, font family and font size come from <code>TextStyleKit</code>. You can also type <code>#</code>, <code>##</code> or <code>###</code> and a space at the start of a line.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="colors"]',
        popover: {
          title: 'Colour and highlight',
          description: `Text colour and multi-colour highlights. ${k(`${mod}+Shift+H`)} toggles the highlight, and typing <code>==text==</code> highlights too. ⌫ clears all formatting.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="align"]',
        popover: {
          title: 'Alignment',
          description: `Left, centre, right and justify for paragraphs and headings. Shortcuts: ${k(`${mod}+Shift+L / E / R / J`)}.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Markdown shortcuts',
          description: `<ul class="tour-list">
            <li><code>**bold**</code> <code>*italic*</code> <code>~~strike~~</code> <code>\`code\`</code></li>
            <li><code>- </code> bullets, <code>1. </code> numbers, <code>[ ] </code> tasks, <code>&gt; </code> quote</li>
            <li><code>\`\`\`</code> code block, <code>---</code> divider</li>
            <li>Typography: <code>--</code> → –, <code>-&gt;</code> → →, <code>(c)</code> → ©, <code>1/2</code> → ½, and "smart quotes"</li>
            <li>Emoticons: <code>:)</code> → 🙂, <code>&lt;3</code> → ❤️</li>
          </ul>`,
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="history"]',
        popover: {
          title: 'Undo and redo',
          description: `${k(`${mod}+Z`)} and ${k(`${mod}+Shift+Z`)}. These go through Yjs, so they only undo <i>your</i> changes and leave collaborators’ edits alone.`,
          side: 'bottom',
        },
      },
    ],
  },

  blocks: {
    title: 'Blocks & embeds',
    summary: 'Lists, tables, code, math, media, callouts and toggles.',
    scope: 'document',
    steps: [
      {
        element: '[data-tour="lists"]',
        popover: {
          title: 'Lists, quotes and code',
          description: `Bullet, numbered and nested <b>task lists</b>. Use ${k('Tab')} and ${k('Shift+Tab')} (or → ←) to indent and outdent.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="insert"]',
        popover: {
          title: 'Insert anything',
          description:
            'Tables, images, YouTube videos, toggle sections, callouts, math and today’s date. The same list opens when you type <kbd>/</kbd> in the document.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Tables',
          description:
            'Put your cursor in a table and a <b>Table</b> row appears under the toolbar: add or delete rows and columns, merge or split cells, and toggle the header row. Drag a column border to resize it.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Code with syntax highlighting',
          description:
            'Code blocks are highlighted by <code>lowlight</code>. With the cursor in one, a language picker appears under the toolbar.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Math (KaTeX)',
          description:
            'Type <code>$$a^2+b^2$$</code> for inline math or <code>$$$\\sum x$$$</code> for a block. Click a formula to edit its LaTeX.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Images and video',
          description:
            '<b>Drop or paste</b> image files straight into the document. Drag an image’s corners to resize it. Add YouTube embeds from <kbd>/</kbd> → YouTube.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Callouts and toggles',
          description:
            'Type <code>:::info</code>, <code>:::warning</code>, <code>:::success</code> or <code>:::danger</code> and a space to start a callout, then click its icon to change the type. Toggle sections fold away any content.',
          side: 'top',
          align: 'start',
        },
      },
    ],
  },

  developer: {
    title: 'Developer playground',
    summary: 'Inspector, events, Markdown import and export, custom extensions.',
    scope: 'document',
    steps: [
      {
        element: '[data-tour="inspector"]',
        popover: {
          title: 'Document output',
          description:
            '<code>getJSON()</code>, <code>getHTML()</code>, <code>getMarkdown()</code> and <code>getText()</code>, updated live. Notice the <code>data-uid</code> attributes, which <b>UniqueID</b> adds to every block.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="inspector"]',
        popover: {
          title: 'Editor events',
          description:
            'The <b>Events</b> tab logs <code>create</code>, <code>update</code>, <code>selectionUpdate</code>, <code>focus</code> and <code>blur</code>. <code>onUpdate</code> also drives a debounced local backup.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="file-menu"]',
        popover: {
          title: 'Import and export',
          description: `Import a <code>.md</code> file, export Markdown, HTML or JSON, save a local backup (${k(`${mod}+S`)}) and restore it.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="view-menu"]',
        popover: {
          title: 'View options',
          description:
            '<b>Read-only</b> calls <code>setEditable(false)</code>. <b>Invisible characters</b> shows spaces, line breaks and paragraph marks. <b>Focus mode</b> dims every block except the one you are in, using the Focus extension.',
          side: 'bottom',
        },
      },
      {
        popover: {
          title: 'Custom extensions in this app',
          description: `<ul class="tour-list">
            <li><b>Callout</b>: a custom node with a React node view and an input rule.</li>
            <li><b>Spoiler</b>: a custom mark with input and paste rules for <code>||text||</code>, and Markdown support.</li>
            <li><b>Shortcuts</b>: commands and shortcuts such as <code>insertDate()</code>, ${k(`${mod}+Shift+D`)}, <code>!today</code> and <code>!shrug</code>.</li>
            <li><b>SlashCommand</b>: built on <code>@tiptap/suggestion</code>.</li>
          </ul>
          The source is in <code>src/editor/extensions/</code>.`,
        },
      },
    ],
  },

  collaboration: {
    title: 'Collaboration',
    summary: 'Real-time editing with Yjs and live cursors.',
    scope: 'document',
    steps: [
      {
        element: '[data-tour="presence"]',
        popover: {
          title: 'Who’s here',
          description:
            'Everyone editing this document right now. Open this page on another device (for example over Tailscale) or in another browser window to watch edits and cursors sync.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="user"]',
        popover: {
          title: 'Your name and colour',
          description: 'Click to rename yourself. Other people see your cursor and selection in this colour.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="connection"]',
        popover: {
          title: 'Sync status',
          description:
            'Edits sync through a Hocuspocus server running inside the dev server and are saved to disk. If the connection drops, keep typing: your changes merge when it comes back.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="share"]',
        popover: {
          title: 'Share the link',
          description:
            'Copy this document’s link and send it to anyone who can reach this server, for example over Tailscale. The library (✍️) lists every document.',
          side: 'bottom',
          align: 'end',
        },
      },
    ],
  },
}

const seenKey = (id: TourId) => (id === 'welcome' ? 'write:tour-seen' : `write:tour-seen:${id}`)

/** Tours that open automatically on a first visit to their page. */
export const hasSeenTour = (id: 'welcome' | 'library') => readStorage(seenKey(id)) === '1'

/**
 * Starts a first-visit tour after `delay`, unless the user starts typing or clicking
 * first: popping an overlay mid-keystroke would steal focus and swallow input. The tour
 * stays unseen, so it can open on a later visit (and the ? button always works).
 */
export function autoStartTour(id: 'welcome' | 'library', delay: number): () => void {
  if (hasSeenTour(id)) return () => undefined
  const timer = window.setTimeout(() => {
    stop()
    startTour(id)
  }, delay)
  const stop = () => {
    window.clearTimeout(timer)
    window.removeEventListener('keydown', stop, true)
    window.removeEventListener('pointerdown', stop, true)
  }
  window.addEventListener('keydown', stop, true)
  window.addEventListener('pointerdown', stop, true)
  return stop
}

export const toursFor = (scope: Tour['scope']) =>
  (Object.entries(TOURS) as [TourId, Tour][]).filter(([, tour]) => tour.scope === scope)

export function startTour(id: TourId) {
  const tour = TOURS[id]
  // Skip steps whose element isn't on the page right now (e.g. an empty library or a
  // hidden sidebar), instead of showing a floating card about something that isn't there.
  const steps = tour.steps.filter((step) => typeof step.element !== 'string' || document.querySelector(step.element))
  const instance = driver({
    showProgress: true,
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'write-tour',
    nextBtnText: 'Next →',
    prevBtnText: '← Back',
    doneBtnText: 'Done',
    steps,
    onDestroyed: () => {
      if (id === 'welcome' || id === 'library') writeStorage(seenKey(id), '1')
    },
  })
  instance.drive()
}
