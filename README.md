# Write

A playground for the [Tiptap](https://tiptap.dev) editor (v3) with most of its extensions enabled, a Google Docs-style document library, real-time collaboration, light and dark themes, and guided tutorial overlays.

## Run it

```bash
bun install
bun dev
```

Open the URL Vite prints. The server listens on every interface, so other devices on your Tailscale network can use `http://<tailscale-ip>:5173` or `http://<machine>.<tailnet>.ts.net:5173`.

- **Library:** the home page lists every document. Start one from a template (Blank, Feature tour, Meeting notes, Project brief, Journal), then search, sort, switch between grid and list, rename, copy or delete.
- **Documents:** each opens at `?doc=<id>`. Everyone with the link edits together. Rename it in the title field (✍️ goes back to the library), and use **File** for new documents, copies, import, export and delete.
- **Theme:** use the theme button for System, Light or Dark. The choice is remembered per browser and applied before first paint.
- **Guided tours:** the library and welcome tours open on your first visit, unless you start typing or clicking first. Replay them, or take the others, from the **?** button or by pressing `?`.

## What's inside

| Area | Features |
| --- | --- |
| StarterKit | Bold, italic, underline, strike, code, links (autolink), headings, lists, blockquote, horizontal rule, hard break, drop and gap cursors, trailing node, Markdown-style shortcuts |
| Small additions | Placeholder, character and word count (soft 50k limit shown in the status bar), Focus, text align, multi-colour highlight, text colour, font family and size (`TextStyleKit`), sub/superscript, Typography, task lists, resizable images, tables, details (toggle sections), YouTube, emoji, invisible characters, UniqueID |
| UI | Bubble menu, floating "+" menu, slash commands, `@` mentions, `:` emoji picker, drag handle, syntax-highlighted code blocks (lowlight), file drop and paste for images, table of contents |
| Content and API | Live JSON, HTML, Markdown and text inspector, an editor event log, Markdown import and export, read-only mode, a local backup driven by `onUpdate` |
| Custom extensions | `Callout` (node with a React node view and an input rule), `Spoiler` (mark with input and paste rules and Markdown support), `Shortcuts` (commands, keyboard shortcuts, `!today` and `!shrug`), `SlashCommand` |
| Bigger lifts | Collaboration (Yjs and Hocuspocus) with live carets and presence, math (KaTeX) |

## Document library

The library is backed by a small REST API that the same Vite plugin serves:

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/docs` | List documents (title, preview text, word count, timestamps) |
| `POST` | `/api/docs` | Create a document (optional `title`) |
| `GET` | `/api/docs/:id/status` | `{ deleted, exists }` |
| `PATCH` | `/api/docs/:id` | Rename. This writes the title into the live Yjs document, so open editors update immediately |
| `POST` | `/api/docs/:id/duplicate` | Copy the document's current state as "Copy of …" |
| `DELETE` | `/api/docs/:id` | Delete. The ID is tombstoned and the server refuses to sync it again, so an open tab can't bring it back |

Titles live in the shared Yjs document (`meta.title`) and sync live. Each time the server persists a document, it also updates `.collab-data/index.json` with the title, preview text and edit time.

## How collaboration works

`server/collab.ts` is a Vite plugin that starts a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server on `127.0.0.1:1234` alongside the dev and preview servers. Browsers connect to `/collab` on the Vite port, and Vite forwards the WebSocket to it, so only port 5173 needs to be reachable. Documents are stored as Yjs updates in `.collab-data/`, which is gitignored. Pending writes are flushed when the dev server stops.

The editor waits for the first sync before it mounts. A brand-new document created from a template is seeded by writing the template straight into the Yjs document. If the server can't be reached within 4 seconds, the editor opens offline and merges its changes when the connection comes back.

## Patched dependency

`patches/@tiptap%2Fy-tiptap@3.0.12.patch` (applied automatically by `bun install`) fixes a bug in y-tiptap 3.0.12's position tracking. Sometimes an extension's `appendTransaction` makes a structural change in the same dispatch as plain typing; for example, TableOfContents assigns an ID when you type the first letter of a new heading, and Link autolinks a URL typed at the start of a line. In that case y-tiptap compared the editor against a Yjs document that didn't contain the typed text yet and threw "Position tracking requires synchronized editor text". The whole keystroke was then dropped. The patch skips position tracking for that one transaction instead of throwing.

## Project layout

```
server/collab.ts          Hocuspocus server and Vite plugin
src/App.tsx               Router: library or document
src/pages/Library.tsx     Document library (templates, search, grid and list, actions)
src/pages/DocumentPage.tsx  Editor page: sync gating, template seeding, view state
src/api.ts                Library API client
src/theme.ts              Theme choice (System, Light, Dark)
src/editor/templates.ts   New-document templates
src/editor/extensions.ts  Every extension and its configuration
src/editor/extensions/    Custom extensions (Callout, Spoiler, Shortcuts, SlashCommand)
src/editor/blocks.tsx     Block insert actions shared by the slash menu, "+" menu and toolbar
src/editor/suggestion/    Popup list used by the slash, mention and emoji menus
src/components/           Toolbar, menus, sidebar (TOC and inspector), header, status bar
src/tours.ts              Tutorial overlays (driver.js)
```

## Scripts

- `bun dev`: dev server with the collaboration server
- `bun run build`: type-check and production build
- `bun run preview`: serve the build (collaboration included)
- `bun run lint`: oxlint
