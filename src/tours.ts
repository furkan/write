import { driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { flushSync } from 'react-dom'
import { closeFlyout, revealTab, type RibbonTab } from './components/ribbon/state'
import { mod } from './editor/platform'
import { readStorage, writeStorage } from './editor/storage'

/**
 * Guided tutorial overlays (driver.js). Each step spotlights an element marked
 * with `data-tour="…"`; steps without an element show as a centred card.
 */

const k = (keys: string) => `<kbd>${keys}</kbd>`

export type TourId = 'library' | 'welcome' | 'formatting' | 'blocks' | 'developer' | 'collaboration'

/** What the current user can do on this page, so steps only describe what they can do. */
export type TourContext = { role: 'owner' | 'editor' | 'viewer' | null; mode: 'access' | 'dev' }

let context: TourContext = { role: null, mode: 'access' }

/** Called by each page with the signed-in user's auth mode and their role on the document. */
export const setTourContext = (next: TourContext) => void (context = next)

/**
 * A step, shown only when `when` (if any) says it applies to the current user. `tab`: the ribbon
 * tab whose group the step points at; it is selected when the step shows.
 */
type TourStep = Omit<DriveStep, 'element'> & { element?: string; when?: (ctx: TourContext) => boolean; tab?: RibbonTab }

/** On a narrow screen the bar's actions fold into the "⋯" menu, so a step about one points there. */
const orMore = (name: string) => `[data-tour="${name}"], [data-tour="more"]`

/** `scope` says which page a tour belongs to (its elements only exist there). */
type Tour = { title: string; summary: string; scope: 'library' | 'document'; steps: TourStep[] }

const isOwner = (ctx: TourContext) => ctx.role === 'owner'

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
            'This is your library: the documents you own and the ones other people have shared with you. Nobody else sees your documents unless you share them.',
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
          title: 'My documents',
          description:
            'Documents you own, sorted by last edit, with a live preview of each one. Use the controls above to switch between grid and list view, or to sort by title. Search and sort cover both sections.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="shared"]',
        popover: {
          title: 'Shared with me',
          description:
            'Documents other people shared with you, with the owner’s email. As an <b>editor</b> you can edit and rename; as a <b>viewer</b> you can read, copy and export.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="doc-actions"]',
        popover: {
          title: 'Rename, share, copy, delete',
          description:
            'Each document’s ⋮ menu can rename it (open editors update live), share it, make a copy, open it in a new tab or move it to the trash. On a document shared with you, <b>Remove from my list</b> takes it off your list.',
          side: 'left',
        },
      },
      {
        element: '[data-tour="trash"]',
        popover: {
          title: 'Trash',
          description:
            'Your deleted documents wait here for 30 days. Restore one, or delete it forever. Right after deleting, the <b>Undo</b> button in the message at the bottom brings it back. While a shared document is in the trash, the people it’s shared with can’t open it.',
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
      {
        element: '[data-tour="account"]',
        when: (ctx) => ctx.mode === 'access',
        popover: {
          title: 'Your account',
          description: 'The email you’re signed in with, and where you sign out.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="account"]',
        when: (ctx) => ctx.mode === 'dev',
        popover: {
          title: 'Your account',
          description:
            'The email you’re using. This server runs in Dev mode, with no sign-in: <b>Switch user…</b> lets you try Write as someone else.',
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
        when: (ctx) => ctx.role !== 'viewer',
        popover: {
          title: 'Title',
          description:
            'Click to rename the document. The title syncs live to collaborators and to the library. The ✍️ logo next to it takes you back to all documents.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="view-only"]',
        when: (ctx) => ctx.role === 'viewer',
        popover: {
          title: 'View only',
          description: 'This document was shared with you as a viewer: you can read, copy and export it, but not change it.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        when: (ctx) => ctx.role === 'viewer',
        popover: {
          title: 'The document',
          description: 'Changes the owner and editors make appear here live, as they type.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        when: (ctx) => ctx.role !== 'viewer',
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
          title: 'Ribbon',
          description:
            'The ribbon is the whole top bar. <b>File</b> has new documents, copies, printing, import and export; <b>Home</b> has fonts, marks, colours, paragraphs and styles; <b>Insert</b> has tables, media, links, equations and blocks; <b>Layout</b> has the page setup; <b>View</b> has the layouts, what to show, and zoom. Hover any button to see its keyboard shortcut. A <b>Table</b> or <b>Code</b> tab appears while you are in a table or code block. The arrow at the far right collapses the ribbon to this row.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="print"]',
        tab: 'file',
        popover: {
          title: 'Print or save as PDF',
          description: `<b>File → Print / PDF</b> (or ${k(`${mod}+P`)}) opens the browser’s print dialog; choose <b>Save as PDF</b> there for a PDF. You always get the pages with their page numbers at 100%, even from Web layout or zoomed in.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="layout-tab"]',
        popover: {
          title: 'Layout',
          description:
            'Margins, orientation and paper size (A4, Letter, Legal, A5) for this document. They belong to the document, so everyone sees the same pages, and only the owner and editors can change them. The page number is in each page’s footer.',
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
        element: '[data-tour="status"]',
        popover: {
          title: 'Status bar',
          description:
            'Word and character counts (with a limit), the block your cursor is in, when the local backup was last saved, and the connection status. On the right, <b>Print layout</b> (pages) or <b>Web layout</b> (one long page), and the <b>zoom</b> slider: click the percentage for presets, <b>Page width</b> and <b>One page</b>. Both are just for you; a narrow window always shows one long page, and zoom then makes the text larger or smaller.',
          side: 'top',
        },
      },
      {
        element: orMore('share'),
        when: isOwner,
        popover: {
          title: 'Share',
          description:
            'Invite people by email as editors or viewers, and copy the link to send them. Only the people listed can open it.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: orMore('share'),
        when: (ctx) => !isOwner(ctx),
        popover: {
          title: 'Who has access',
          description:
            'See who this document is shared with, and copy its link. Only the owner can invite people, and the link opens only for the people listed.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: orMore('theme'),
        popover: {
          title: 'Light or dark',
          description: 'Switch the theme here, or let it follow your system setting.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: orMore('help'),
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
          description: `Bold ${k(`${mod}+B`)}, italic ${k(`${mod}+I`)}, underline ${k(`${mod}+U`)}, strike ${k(`${mod}+Shift+S`)}, code ${k(`${mod}+E`)}, subscript ${k(`${mod}+,`)}, superscript ${k(`${mod}+.`)}, and a custom <b>spoiler</b> mark ${k(`${mod}+Alt+S`)}. Links (${k(`${mod}+K`)}) are on the <b>Insert</b> tab.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="font"]',
        popover: {
          title: 'Font and size',
          description:
            'Font family and size come from <code>TextStyleKit</code>. Type a size and press <kbd>Enter</kbd>, pick one from the list, or use the bigger and smaller <b>A</b> buttons. The eraser clears all formatting.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="colors"]',
        popover: {
          title: 'Colour and highlight',
          description: `Click the <b>A</b> or the highlighter to apply the colour under it again, or the arrow next to it to pick another. ${k(`${mod}+Shift+H`)} toggles the highlight, and typing <code>==text==</code> highlights too.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="text-style"]',
        popover: {
          title: 'Styles',
          description: `Normal text and Heading 1–6, each shown in its own style. ${k(`${mod}+Alt+0…6`)} applies them, and so does typing <code>#</code>, <code>##</code> or <code>###</code> and a space at the start of a line.`,
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
          title: 'Lists',
          description: `Bullet, numbered and nested <b>task lists</b>. Use ${k('Tab')} and ${k('Shift+Tab')}, or the indent buttons, to indent and outdent. Quote and code block sit under them.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="insert-tab"]',
        popover: {
          title: 'Insert anything',
          description:
            'The <b>Insert</b> tab has tables, pictures, YouTube videos, links, equations, emoji, callouts, toggle sections, dividers and today’s date. Typing <kbd>/</kbd> in the document opens the same blocks.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Tables',
          description:
            'Put your cursor in a table and a <b>Table</b> tab appears in the ribbon: add or delete rows and columns, merge or split cells, and toggle the header row. Drag a column border to resize it.',
          side: 'top',
          align: 'start',
        },
      },
      {
        element: '[data-tour="editor"]',
        popover: {
          title: 'Code with syntax highlighting',
          description:
            'Code blocks are highlighted by <code>lowlight</code>. With the cursor in one, the ribbon’s <b>Code</b> tab picks its language.',
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
    summary: 'Markdown import and export, view options, custom extensions.',
    scope: 'document',
    steps: [
      {
        element: '[data-tour="file-export"]',
        tab: 'file',
        popover: {
          title: 'Import and export',
          description: `On the <b>File</b> tab: import a <code>.md</code> file, export <code>getMarkdown()</code>, <code>getHTML()</code> or <code>getJSON()</code> (notice the <code>data-uid</code> attributes <b>UniqueID</b> adds to every block). Owners and editors can also save a local backup (${k(`${mod}+S`)}, driven by <code>onUpdate</code>) and restore it.`,
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="show"]',
        tab: 'view',
        popover: {
          title: 'View options',
          description:
            'On the <b>View</b> tab: <b>Invisible characters</b> shows spaces, line breaks and paragraph marks, and <b>Focus mode</b> dims every block except the one you are in, using the Focus extension. Next to them, <b>Read-only</b> calls <code>setEditable(false)</code>, and <b>Print layout</b> and <b>Web layout</b> switch between pages and one long page.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="zoom"]',
        tab: 'view',
        popover: {
          title: 'Zoom',
          description:
            'CSS <code>zoom</code> on the editor, so the browser maps clicks, carets and selections and ProseMirror needs nothing special. Pagination divides its measurements by the scale, so the page count never changes with zoom. <b>Page width</b> and <b>One page</b> follow the window.',
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
            <li><b>Pagination</b>: Print layout's pages, drawn with decorations only (floats in one widget), so the shared document never changes. Trimmed from <code>tiptap-pagination-plus</code>.</li>
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
        element: orMore('presence'),
        popover: {
          title: 'Who’s here',
          description:
            'Everyone who has this document open right now, shown by the part of their email before the @. Hover an avatar, or a caret in the text, for the full email.',
          side: 'bottom',
        },
      },
      {
        element: orMore('account'),
        popover: {
          title: 'You',
          description:
            'Others see your cursor labelled with the part of your email before the @, in this colour. The colour comes from your email, so it’s the same on every device.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="connection"]',
        popover: {
          title: 'Sync status',
          description:
            'Edits sync through a Hocuspocus server running inside the app server and are saved to disk. If the connection drops, or your session expires, keep typing: your changes merge when it comes back.',
          side: 'top',
        },
      },
      {
        element: orMore('share'),
        popover: {
          title: 'Who has access',
          description:
            'The owner invites people by email as <b>editors</b> or <b>viewers</b>; everyone else sees who has access. <b>Copy link</b> gives you the address to send, which opens only for the people listed.',
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
  if (TOURS[id].scope === 'document') {
    // The ribbon's groups are on its Home tab: show it, then look for them once it has rendered.
    revealTab()
    requestAnimationFrame(() => runTour(id))
  } else runTour(id)
}

/** A step on a ribbon tab selects that tab (synchronously, so its group is there) before it shows. */
const onTab = (tab: RibbonTab, selector: string) => () => {
  flushSync(() => revealTab(tab))
  return document.querySelector(selector) ?? document.body
}

function runTour(id: TourId) {
  const tour = TOURS[id]
  // Skip steps whose element isn't on the page right now (e.g. an empty library or a
  // hidden sidebar), instead of showing a floating card about something that isn't there.
  // A step on another ribbon tab is there once the tab is selected.
  const steps: DriveStep[] = tour.steps
    .filter((step) => step.when?.(context) ?? true)
    .filter((step) => step.tab || !step.element || document.querySelector(step.element))
    .map(({ when: _when, tab, element, ...step }) => ({ ...step, element: tab && element ? onTab(tab, element) : element }))
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
    // Not `onDestroyed`: driver.js skips it when the tour ends mid-animation (a quick Done).
    onDestroyStarted: () => {
      closeFlyout()
      if (id === 'welcome' || id === 'library') writeStorage(seenKey(id), '1')
      instance.destroy()
    },
  })
  instance.drive()
}
