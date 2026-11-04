# Write

A playground for the [Tiptap](https://tiptap.dev) editor (v3) with most of its extensions enabled, real-time collaboration, and guided tutorial overlays.

## Run it

```bash
bun install
bun dev
```

Open the URL Vite prints. The server listens on every interface, so other devices on your Tailscale network can use `http://<tailscale-ip>:5173` or `http://<machine>.<tailnet>.ts.net:5173`.

- **Separate documents:** add `?doc=name` to the URL. Everyone on the same name edits together.
- **Guided tours:** the welcome tour opens on your first visit. Replay it, or take the other tours, from the **?** button. Pressing `?` outside the document also replays the welcome tour.

## What's inside

| Area | Features |
| --- | --- |
| StarterKit | Bold, italic, underline, strike, code, links (autolink), headings, lists, blockquote, horizontal rule, hard break, drop and gap cursors, trailing node, Markdown-style shortcuts |
| Small additions | Placeholder, character and word count (soft 50k limit shown in the status bar), Focus, text align, multi-colour highlight, text colour, font family and size (`TextStyleKit`), sub/superscript, Typography, task lists, resizable images, tables, details (toggle sections), YouTube, emoji, invisible characters, UniqueID |
| UI | Bubble menu, floating "+" menu, slash commands, `@` mentions, `:` emoji picker, drag handle, syntax-highlighted code blocks (lowlight), file drop and paste for images, table of contents |
| Content and API | Live JSON, HTML, Markdown and text inspector, an editor event log, Markdown import and export, read-only mode, a local backup driven by `onUpdate` |
| Custom extensions | `Callout` (node with a React node view and an input rule), `Spoiler` (mark with input and paste rules and Markdown support), `Shortcuts` (commands, keyboard shortcuts, `!today` and `!shrug`), `SlashCommand` |
| Bigger lifts | Collaboration (Yjs and Hocuspocus) with live carets and presence, math (KaTeX) |

## How collaboration works

`server/collab.ts` is a Vite plugin that starts a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server on `127.0.0.1:1234` alongside the dev and preview servers. Browsers connect to `/collab` on the Vite port, and Vite forwards the WebSocket to it, so only port 5173 needs to be reachable. Documents are stored as Yjs updates in `.collab-data/`, which is gitignored. Pending writes are flushed when the dev server stops.

The editor waits for the first sync before it mounts. A brand-new document is seeded with demo content by writing it straight into the Yjs document. If the server can't be reached within 4 seconds, the editor opens offline and merges its changes when the connection comes back.

## Patched dependency

`patches/@tiptap%2Fy-tiptap@3.0.12.patch` (applied automatically by `bun install`) fixes a bug in y-tiptap 3.0.12's position tracking. Sometimes an extension's `appendTransaction` makes a structural change in the same dispatch as plain typing; for example, TableOfContents assigns an ID when you type the first letter of a new heading, and Link autolinks a URL typed at the start of a line. In that case y-tiptap compared the editor against a Yjs document that didn't contain the typed text yet and threw "Position tracking requires synchronized editor text". The whole keystroke was then dropped. The patch skips position tracking for that one transaction instead of throwing.

## Project layout

```
server/collab.ts          Hocuspocus server and Vite plugin
src/App.tsx               Editor setup, sync gating, view state
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
