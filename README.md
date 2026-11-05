# Write

A playground for the [Tiptap](https://tiptap.dev) editor (v3) with most of its extensions enabled, a Google Docs-style document library, real-time collaboration, light and dark themes, and guided tutorial overlays.

## Run it

```bash
bun install
bun dev
```

Open the URL Vite prints. The server listens on every interface, so other devices on your Tailscale network can use `http://<tailscale-ip>:5173` or `http://<machine>.<tailnet>.ts.net:5173`.

`bun dev` runs in **Dev mode**: there is no sign-in, and you are `dev@localhost` (or `WRITE_DEV_USER`, or whoever the `write-dev-user` cookie names, so you can try several users in one browser). `bun run preview` runs in **Access mode** (see [Running the pilot](#running-the-pilot-access-mode)). Settings are `WRITE_*` environment variables, all listed in [`.env.example`](.env.example); they can also go in a `.env.local` file. Both ports are fixed: if the app port or the collaboration port is taken, startup stops with an error instead of moving to another port.

- **Library:** the home page lists your documents and the ones shared with you. Start one from a template (Blank, Feature tour, Meeting notes, Project brief, Journal), then search, sort, switch between grid and list, rename, copy or move to the trash.
- **Trash:** deleting moves a document to the Trash (with an **Undo** button right after). Restore it from the Trash for 30 days; after that it is deleted forever. You can also delete forever or empty the Trash by hand.
- **Documents:** each opens at `?doc=<id>`, for its owner and the people it is shared with (editors edit together; viewers read). Rename it in the title field (✍️ goes back to the library), and use **File** for new documents, copies, import, export and moving it to the trash.
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

The library is backed by a small REST API that the same Vite plugin serves. Every document has one **Owner** (whoever created it) and a list of **Shares** (`email → editor | viewer`); see [`GLOSSARY.md`](GLOSSARY.md) for the terms.

| Method | Path | Who | |
| --- | --- | --- | --- |
| `GET` | `/api/me` | anyone | `{ email, mode }`: the signed-in user and the auth mode (`access` or `dev`) |
| `GET` | `/api/docs` | anyone | Your open documents plus those shared with you (title, preview, word count, timestamps, `owner`, your `role`; `shares` only on your own) |
| `POST` | `/api/docs` | anyone | Create a document (optional `title`), owned by you with no shares. The only way to create one |
| `GET` | `/api/docs/:id` | any role | The document with `owner`, your `role` and its `shares` |
| `GET` | `/api/docs/:id/status` | anyone | `{ access, trashed, deleted }`; `access` is `owner`, `editor`, `viewer` or `none`. Always 200. See below |
| `PATCH` | `/api/docs/:id` | owner, editor | Rename. This writes the title into the live Yjs document, so open editors update immediately |
| `POST` | `/api/docs/:id/duplicate` | any role | Copy the document's current state as "Copy of …", owned by you with no shares |
| `DELETE` | `/api/docs/:id` | owner | Move to the Trash. Shares stay but are inactive; open tabs are disconnected |
| `PUT` | `/api/docs/:id/shares/:email` | owner | Share with `email` or change their role. Body `{ "role": "editor" \| "viewer" }`. The email is lowercased; 400 for an invalid email or the owner's own, 409 past 50 shares |
| `DELETE` | `/api/docs/:id/shares/:email` | owner, or that user | Unshare, or **Remove from my list** when it is your own email |
| `GET` | `/api/trash` | anyone | Your own Trash (with `trashedAt` and `purgeAt`) |
| `POST` | `/api/trash/:id/restore` | owner | Restore from the Trash; its shares become active again |
| `DELETE` | `/api/trash/:id` | owner | Delete forever (only documents in the Trash), with its shares. The ID is tombstoned, so an open tab can't bring it back |
| `DELETE` | `/api/trash` | anyone | Empty your Trash: deletes forever the IDs in the body (`{ "ids": [...] }`) that are your own trashed documents, so anything trashed after you looked, or anyone else's, is kept |

Every `/api/*` request needs an identity (401 without one; 503 when Access's signing keys can't be fetched or used, so a Cloudflare outage doesn't look like an expired session). Request bodies are capped at 64 KB (413), and server errors answer a plain `{ "error": "error" }` with the details in the log. Requests other than `GET` and `HEAD` also need an `Origin` header matching the request's `Host` (or one of `WRITE_ALLOWED_ORIGINS`), otherwise they get 403.

**No access looks like not found.** Every handler resolves your role on the document before doing anything else. Without one, every route answers 404 (and the collaboration socket `permission-denied`), the same whether the document never existed, is someone else's, is in someone's Trash or was deleted forever, so IDs leak nothing. With a role that doesn't allow the action (a viewer renaming, an editor trashing) you get 403. `status` tells only people who had a role why a document closed: its owner sees `{ access: "owner", trashed: true }` for a trashed document, a collaborator `{ access: "none", trashed: true }`, and the former owner of a purged one `{ access: "none", deleted: true }`; everyone else gets `{ access: "none", trashed: false, deleted: false }`.

**The collaboration socket** opens only documents in the index, for users with a role: a `?doc=` name nobody created is refused rather than created. A viewer's connection is read-only, enforced by the server, which drops their updates. Whenever access to a document changes (share, unshare, role change, trash, restore, delete forever), the server closes every socket on that document; clients reconnect, are authorized again with their new role, and Yjs merges anything they had not synced.

Titles live in the shared Yjs document (`meta.title`) and sync live. Each time the server persists a document, it also updates `index.json` in the data dir with the title, preview text and edit time. `index.json` (version 2) also holds each document's `owner` and `shares`, and the tombstones with their former owner. Trashed documents keep their file until they are deleted forever; the server checks hourly for ones older than 30 days.

**Upgrading from an index without owners** (version 1): on first start, the server takes a backup snapshot, gives every document without an owner to the Legacy owner, `WRITE_OWNER_EMAIL`, and rewrites the index as version 2. In Dev mode `WRITE_OWNER_EMAIL` defaults to the dev identity (`WRITE_DEV_USER`, else `dev@localhost`); in Access mode the server refuses to start while ownerless documents exist and it is unset. `.ydoc` files with no index entry are left on disk and never served. When Vite restarts by itself (after `vite.config.ts`, a server file or an `.env` file changes), the collaboration server restarts with it: open documents are stored, the collaboration port is released and bound again with the new settings, and open tabs reconnect. Only the first restart after pulling this change needs a manual stop and start, because the server already running predates this behaviour.

## Identity

`server/auth.ts` decides who a request comes from, and the auth mode follows the Vite command, so there is nothing to forget:

- **Access mode** (`vite preview`): the user is the `email` in the Cloudflare Access JWT from the `Cf-Access-Jwt-Assertion` header, trimmed and lowercased. The JWT is verified with [`jose`](https://github.com/panva/jose) against the team's signing keys (fetched from `https://<WRITE_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` and refetched when Access rotates them), with `iss` = `https://<WRITE_ACCESS_TEAM_DOMAIN>` and `aud` = `WRITE_ACCESS_AUD`. A missing or invalid JWT gets 401; a JWT without an email (an Access service token) gets 403. The `CF_Authorization` cookie is never read. The server refuses to start without both variables.
- **Dev mode** (`vite dev`): the `write-dev-user` cookie, else `WRITE_DEV_USER`, else `dev@localhost`, with no verification.

The same check runs on every collaboration connection, in Hocuspocus's `onAuthenticate`, using the WebSocket upgrade's headers (Vite's `/collab` proxy passes them through). It runs there rather than in the proxy because Hocuspocus listens on `127.0.0.1`, which any local process can reach directly. Collaboration connections also need a same-origin `Origin`, which stops other sites from opening a socket with the user's cookie.

Each security event is logged as one JSON line on stdout, such as `{"audit":"auth_fail","status":401,"reason":"ERR_JWT_EXPIRED","via":"api",...}`: `auth_fail`, `create`, `share`, `role_change`, `unshare`, `trash`, `restore`, `purge` (with `actor`: the user, or `expiry` for the 30-day cleanup) and `migration`.

## Running the pilot (Access mode)

The pilot is a separate checkout with its own data dir and ports, bound to `127.0.0.1` and reached only through `cloudflared` and Cloudflare Access:

1. In Cloudflare Zero Trust, create a self-hosted Access application for the pilot's hostname and note its AUD tag. Under the application's cookie settings, set **SameSite** to **Lax**: the `CF_Authorization` cookie defaults to `None`, which lets other sites send it.
2. Copy `.env.example` to an env file and set at least `WRITE_ACCESS_TEAM_DOMAIN`, `WRITE_ACCESS_AUD`, `WRITE_ALLOWED_HOSTS` (the pilot's hostname), `WRITE_DATA_DIR`, `WRITE_BACKUP_DIR`, and a `WRITE_COLLAB_PORT` other than 1234 if the dev server runs on the same machine.
3. Run `bun install && bun run build && bun run preview` from a systemd unit with `EnvironmentFile=` pointing at that file, and point `cloudflared` at `http://127.0.0.1:<WRITE_PORT>`.

The startup log has one line naming the mode, such as `[write] Access mode: every request needs a Cloudflare Access JWT for team acme.cloudflareaccess.com; ...`.

## Backups

When the server starts, and every hour after that, it checks the newest snapshot; if it is a day old or there is none, it copies `.collab-data/` to a timestamped folder in `.collab-backups/` (for example `.collab-backups/2026-11-05T09-30-00Z/`) and keeps the newest 14. Set `WRITE_BACKUP_DIR` to keep them somewhere else, such as another disk. Copies are written to a `.partial` folder first and renamed when complete; incomplete ones are removed.

To restore, stop the server, replace `.collab-data/` with a snapshot (or copy single `.ydoc` files back along with its `index.json`), then start it again.

## How collaboration works

`server/collab.ts` is a Vite plugin that starts a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server on `127.0.0.1:1234` (`WRITE_COLLAB_PORT`) alongside the dev and preview servers. Browsers connect to `/collab` on the Vite port, and Vite forwards the WebSocket to it, so only port 5173 needs to be reachable. Documents are stored as Yjs updates in `.collab-data/` (`WRITE_DATA_DIR`), which is gitignored. Pending writes are flushed when the dev server stops.

The editor waits for the first sync before it mounts. A brand-new document created from a template is seeded by writing the template straight into the Yjs document. If the server can't be reached within 4 seconds, the editor opens offline and merges its changes when the connection comes back.

## Patched dependency

`patches/@tiptap%2Fy-tiptap@3.0.12.patch` (applied automatically by `bun install`) fixes a bug in y-tiptap 3.0.12's position tracking. Sometimes an extension's `appendTransaction` makes a structural change in the same dispatch as plain typing; for example, TableOfContents assigns an ID when you type the first letter of a new heading, and Link autolinks a URL typed at the start of a line. In that case y-tiptap compared the editor against a Yjs document that didn't contain the typed text yet and threw "Position tracking requires synchronized editor text". The whole keystroke was then dropped. The patch skips position tracking for that one transaction instead of throwing.

## Project layout

```
server/collab.ts          Hocuspocus server, REST API and Vite plugin
server/auth.ts            Identity: Access JWT verification, Dev mode cookie, Origin check
server/config.ts          WRITE_* settings, read once in vite.config.ts
server/audit.ts           Audit log lines
tests/                    bun test suites: unit tests and the real server in Dev and Access modes
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
- `bun run build`: type-check and production build. Each page and the large libraries (editor, emoji, KaTeX, syntax highlighting, Yjs, React) are separate chunks, so the library page doesn't download the editor
- `bun run preview`: serve the build (collaboration included)
- `bun run lint`: oxlint
- `bun run test`: the `bun test` suites. They start real servers on ports 5180/1240 (dev) and 4180/1241 (preview) with temporary data dirs (set `WRITE_TEST_TMP` to choose where), so they never touch a running dev server or its data. Access mode is tested against a local key server with tokens the tests sign
