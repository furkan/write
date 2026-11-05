# Write

A playground for the [Tiptap](https://tiptap.dev) editor (v3) with most of its extensions enabled, a Google Docs-style document library, real-time collaboration, light and dark themes, and guided tutorial overlays.

## Run it

```bash
bun install
bun dev
```

Already running Write from before per-user access? Follow [Upgrading a Dev server](#upgrading-a-dev-server-from-before-per-user-access) first: stop `bun dev` before you pull.

Open the URL Vite prints. The server listens on every interface, so other devices on your Tailscale network can use `http://<tailscale-ip>:5173` or `http://<machine>.<tailnet>.ts.net:5173`.

`bun dev` runs in **Dev mode**: there is no sign-in, and you are `dev@localhost` (or `WRITE_DEV_USER`, or whoever the `write-dev-user` cookie names; the account menu's **Switch user…** sets that cookie, so you can try several users in one browser). `bun run preview` runs in **Access mode** (see [Running the pilot](#running-the-pilot-access-mode)). Settings are `WRITE_*` environment variables, all listed in [`.env.example`](.env.example); they can also go in a `.env.local` file. Both ports are fixed: if the app port or the collaboration port is taken, startup stops with an error instead of moving to another port.

- **Library:** the home page has two sections, **My documents** and **Shared with me** (with each owner's email). Start a document from a template (Blank, Feature tour, Meeting notes, Project brief, Journal), then search and sort (both cover both sections), switch between grid and list, and use each document's ⋮ menu. What the menu offers follows your role: the owner can rename, share, copy and move to the trash; an editor can rename and copy; a viewer can copy. On a document shared with you, **Remove from my list** drops your own share (only the owner can share it with you again).
- **Sharing:** the owner opens **Share** (at the right of the ribbon's top bar, on the **File** tab or in the library's ⋮ menu), adds people by email as **Editor** or **Viewer**, changes their role or removes them, and uses **Copy link** to send the address. The link opens only for the people listed: there is no link sharing. People also need access to Write itself (the Access policy), which the admin manages. Up to 50 people per document. Everyone else with access sees the same list, read-only.
- **Trash:** deleting moves a document to your Trash (with an **Undo** button right after). Only the owner can trash a document, and the Trash shows only your own. Restore it for 30 days; after that it is deleted forever. You can also delete forever or empty the Trash by hand. While a shared document is in the Trash, the people it is shared with can't open it: an open tab says "The owner moved this document to the trash", and access comes back if the owner restores it.
- **Documents:** each opens at `?doc=<id>`, for its owner and the people it is shared with. Owners and editors edit together; viewers get a **View only** badge and a read-only editor and title, and the **File** tab keeps only what doesn't change the document (copy, export, print). **View → Read-only** stays available to owners and editors as a view preference. Rename a document in the title field at the left of the ribbon (✍️ goes back to the library), and use the **File** tab for new documents, copies, import, export, printing and moving it to the trash (owner only). If the owner changes your role, removes you or trashes the document while you have it open, the page follows within a few seconds. Your role comes from the collaboration connection itself, so until it is known (for example when a document opens offline) the editor stays read-only. If you are made a viewer while typing, anything the server didn't accept stays on your screen with a notice that it wasn't saved, and the status bar says "Not saved" instead of "Synced".
- **Presence:** collaborators' carets and avatars are labelled with the part of their email before the `@` (hover for the full email), in a colour derived from the email, so it is the same on every device. Names can't be edited.
- **Account:** the round button at the right of the ribbon shows the email you're signed in with. In Access mode it has **Sign out**; in Dev mode, **Switch user…**.
- **Session expiry:** if your Cloudflare Access session expires while a document is open, a banner offers **Sign in again**, which opens a new tab. Keep typing meanwhile: once you have signed in, the tab reconnects and your changes merge. A dropped network connection shows "Offline" instead. If Cloudflare Access can't check who you are for a while (its signing keys are unavailable), the status bar says it is retrying, and the tab reconnects by itself, waiting longer each time (up to 30 seconds). If Write can't confirm who you are when a page loads, it shows a sign-in screen. If the browser is now signed in as someone else (another account in the new tab, or **Switch user…** in another tab), an open tab stops syncing rather than carry on as that person, and offers to reload as them or to sign back in (in Dev mode, switch back).
- **Local backups:** your own edits are snapshotted to this browser's storage per user and document (`write:backup:<email>:<id>`), and **File → Restore backup…** brings them back. Only your own changes are backed up: opening a document, or edits arriving from collaborators, never replace your backup. Viewers take none. A backup made before documents had owners (`write:backup:<id>`) is copied to the owner's key when the owner opens the document, unless they already have a newer one; collaborators never get it.
- **Ribbon:** the document page's whole top bar is a Word-style ribbon (there is no separate header). Its row holds ✍️ (back to the library), the title, undo and redo, the tabs **File · Home · Insert · Layout · View** (plus **Table** and **Code** while you're in one), then who's here, **Share**, the theme, your account and the **?** tours. The arrow at the far right collapses it to that row (remembered per browser); a tab then opens over the document. On a narrow screen, or whenever a tab's groups don't fit, the panel and the tabs scroll sideways. Below 860 px wide, who's here, Share, theme, account and tours fold into one **⋯** menu, and below 560 px the title and the tabs take a row each, so the page never scrolls sideways.
- **File tab:** **New document**, **Make a copy**, **All documents**, **Print / PDF**, **Share** (or **Who has access**), **Import Markdown**, **Export** Markdown, HTML or JSON, the local backup (**Save backup** `Ctrl/⌘+S`, **Restore backup…**, **Reset to demo…**) and **Move to trash**. Viewers keep copy, export, print and who has access; import and the backups are for owners and editors (disabled in Read-only); the trash is the owner's.
- **Print / Save as PDF:** **File → Print / PDF** or `Ctrl/⌘+P` opens the browser's print dialog; choose **Save as PDF** as the destination for a PDF. Printing always gives the document's pages with "Page N of M" at 100%: in Web layout, on a phone or zoomed, the page switches to Print layout at 100% while the dialog is open and switches back afterwards, to the same place in the document. Printing from the browser's own menu skips that step; it still prints at 100%, and from Web layout (or on a phone) the sheets are numbered by `@page`.
- **App shell:** on a document, the ribbon stays at the top and the status bar at the bottom; only the document scrolls between them. The page itself never scrolls or bounces, so there is no pull-to-refresh past the ribbon and nothing below the status bar (the library scrolls as a normal page). The scrolling keys work as soon as the document opens. On a phone the shell ends above the on-screen keyboard, so the status bar and the caret stay visible.
- **View tab:** **Print layout** and **Web layout**; **Contents** (the sidebar), **Invisible characters** and **Focus mode**; **Read-only**; the **Zoom** group; and the **Theme**.
- **Zoom:** 50% to 200%, from the View tab (**Zoom ▾** presets, **100%**, **Zoom in** and **Zoom out** in 10% steps, **One page** and **Page width**) or Word's slider at the right of the status bar (a range input: arrow keys, Home and End; click the percentage for the presets). **Page width** and **One page** apply in Print layout and follow the window. In one continuous page (Web layout, or below 900 px wide) zoom makes the text larger or smaller and it reflows. Zoomed in, a page wider than the document area scrolls sideways, and the Contents sidebar stays beside it. Resizing an image or a table column follows the pointer at any zoom. Zoom is yours, remembered per browser and never stored in the document; the browser's own zoom keys are left alone. It is CSS `zoom` on the editor, so clicks, carets, selections, menus and collaborators' carets stay where they belong, and the page count doesn't change with it.
- **Print layout:** documents show as pages, like Word, with a page number in each footer. **Print layout** and **Web layout** (one continuous page) are on the **View** tab and are two buttons at the right of the status bar; the choice is yours, remembered per browser. Below 900 px wide the document is always continuous, and those controls say so. When the window is too narrow for the page (as zoomed) and the sidebar side by side, the sidebar moves below the document. Tables break between rows, with merged cells kept in their columns; a row, task item, image or formula taller than a page is split or scaled to fit. Printing gives one sheet per page, on white paper in either theme, without the app around it (see **Print / Save as PDF**).
- **Layout tab:** the ribbon's **Layout** tab sets the page setup: **Margins** (Normal, Narrow, Wide), **Orientation** (Portrait, Landscape) and **Size** (A4, Letter, Legal, A5). It belongs to the document, so everyone sees the same pages; owners and editors change it, viewers and read-only see it disabled. New documents are A4 portrait with normal margins. A page setup change is a step in your undo history, like typing: **Undo** (or Ctrl+Z) right after choosing Letter goes back to A4. Renaming the document is not undone this way.
- **Theme:** use the theme button in the ribbon's top bar (or **View → Theme**) for System, Light or Dark. The choice is remembered per browser and applied before first paint.
- **Guided tours:** the library and welcome tours open on your first visit, unless you start typing or clicking first. Replay them, or take the others, from the **?** button (in the **⋯** menu on a narrow screen) or by pressing `?`. Steps about the File or View tab open that tab.

## What's inside

| Area | Features |
| --- | --- |
| StarterKit | Bold, italic, underline, strike, code, links (autolink), headings, lists, blockquote, horizontal rule, hard break, drop and gap cursors, trailing node, Markdown-style shortcuts |
| Small additions | Placeholder, character and word count (soft 50k limit shown in the status bar), Focus, text align, multi-colour highlight, text colour, font family and size (`TextStyleKit`), sub/superscript, Typography, task lists, resizable images, tables, details (toggle sections), YouTube, emoji, invisible characters, UniqueID |
| UI | Word-style ribbon as the whole top bar (title, quick access undo and redo; File, Home, Insert, Layout and View tabs; contextual Table and Code tabs; Share, theme, account and tours; collapsible; `lucide-react` icons), print and save as PDF, zoom (50–200%, page width, one page), bubble menu, floating "+" menu, slash commands, `@` mentions, `:` emoji picker, drag handle, syntax-highlighted code blocks (lowlight), file drop and paste for images, table of contents |
| Content and API | Markdown import and export, HTML and JSON export, read-only mode, a local backup driven by `onUpdate` |
| Custom extensions | `Callout` (node with a React node view and an input rule), `Spoiler` (mark with input and paste rules and Markdown support), `Shortcuts` (commands, keyboard shortcuts, `!today` and `!shrug`), `SlashCommand`, `Pagination` (pages from decorations, trimmed from [tiptap-pagination-plus](https://github.com/RomikMakavana/tiptap-pagination-plus), MIT) |
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

Every `/api/*` request needs an identity (401 without one; 503 when Access's signing keys can't be fetched or used, so a Cloudflare outage doesn't look like an expired session). For the same reason, a collaboration socket is closed with code 1013 ("Try Again Later"), so the client reconnects and is checked again. Request bodies are capped at 64 KB (413), and server errors answer a plain `{ "error": "error" }` with the details in the log. Requests other than `GET` and `HEAD` also need an `Origin` header matching the request's `Host` (or one of `WRITE_ALLOWED_ORIGINS`), otherwise they get 403.

**No access looks like not found.** Every handler resolves your role on the document before doing anything else. Without one, every route answers 404 (and the collaboration socket `permission-denied`), the same whether the document never existed, is someone else's, is in someone's Trash or was deleted forever, so IDs leak nothing. With a role that doesn't allow the action (a viewer renaming, an editor trashing) you get 403. `status` tells only people who had a role why a document closed: its owner sees `{ access: "owner", trashed: true }` for a trashed document, a collaborator `{ access: "none", trashed: true }`, and the former owner of a purged one `{ access: "none", deleted: true }`; everyone else gets `{ access: "none", trashed: false, deleted: false }`.

**The collaboration socket** opens only documents in the index, for users with a role: a `?doc=` name nobody created is refused rather than created. A viewer's connection is read-only, enforced by the server, which drops their updates. Whenever access to a document changes (share, unshare, role change, trash, restore, delete forever), the server closes every socket on that document; clients reconnect, are authorized again with their new role, and Yjs merges anything they had not synced. Each client then announces its presence again, so carets and avatars come back without anyone moving. A presence ID belongs to the user who first sent it, while they are connected and for a minute after, so nobody else can take it over while its owner reconnects.

Titles live in the shared Yjs document (`meta.title`) and sync live, like the page setup (`meta.pageSize`, `meta.pageOrientation`, `meta.pageMargins`; missing means A4, portrait, normal). Each time the server persists a document, it also updates `index.json` in the data dir with the title, preview text and edit time. `index.json` (version 2) also holds each document's `owner` and `shares`, and the tombstones with their former owner. Trashed documents keep their file until they are deleted forever; the server checks hourly for ones older than 30 days.

### Upgrading a Dev server from before per-user access

That is, from an `index.json` without owners (version 1):

1. **Stop `bun dev` before you pull.** If it is running, Vite restarts into the new code, which can't take the collaboration port from the old server: you get `server restart failed`, and open tabs reload and show "Write can't reach the server" until you restart. The new server binds the port before it touches your data, so nothing is migrated in that case.
2. Pull, then run `bun install`: this change adds the `jose` dependency.
3. Start `bun dev`. On this first start the server copies the data dir to a backup snapshot (in `.collab-backups/`, or `WRITE_BACKUP_DIR`), then gives every document without an owner to the Legacy owner, `WRITE_OWNER_EMAIL`, and rewrites the index as version 2. In Dev mode `WRITE_OWNER_EMAIL` defaults to the dev identity: `WRITE_DEV_USER`, else `dev@localhost`. So everything is owned by `dev@localhost` (or `WRITE_DEV_USER`), and you see it all as long as you are that user (**Switch user…** changes who you are). The log shows one `{"audit":"migration",...}` line with the snapshot's path. Documents in the Trash stay there with their dates, and old local backups (`write:backup:<id>`) are copied to the owner's own key the first time they open the document.

In Access mode the server refuses to start while ownerless documents exist and `WRITE_OWNER_EMAIL` is unset. `.ydoc` files with no index entry are left on disk and never served. After this upgrade, when Vite restarts by itself (after `vite.config.ts`, a server file or an `.env` file changes), the collaboration server restarts with it: open documents are stored, the collaboration port is released and bound again with the new settings, and open tabs reconnect.

## Identity

`server/auth.ts` decides who a request comes from, and the auth mode follows the Vite command, so there is nothing to forget:

- **Access mode** (`vite preview`): the user is the `email` in the Cloudflare Access JWT from the `Cf-Access-Jwt-Assertion` header, trimmed and lowercased. The JWT is verified with [`jose`](https://github.com/panva/jose) against the team's signing keys (fetched from `https://<WRITE_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` and refetched when Access rotates them), with `iss` = `https://<WRITE_ACCESS_TEAM_DOMAIN>` and `aud` = `WRITE_ACCESS_AUD`. A missing or invalid JWT gets 401; a JWT without an email (an Access service token) gets 403. The `CF_Authorization` cookie is never read. The server refuses to start without both variables.
- **Dev mode** (`vite dev`): the `write-dev-user` cookie, else `WRITE_DEV_USER`, else `dev@localhost`, with no verification.

The same check runs on every collaboration connection, in Hocuspocus's `onAuthenticate`, using the WebSocket upgrade's headers (Vite's `/collab` proxy passes them through). It runs there rather than in the proxy because Hocuspocus listens on `127.0.0.1`, which any local process can reach directly. Collaboration connections also need a same-origin `Origin`, which stops other sites from opening a socket with the user's cookie.

Each security event is logged as one JSON line on stdout, such as `{"audit":"auth_fail","status":401,"reason":"ERR_JWT_EXPIRED","via":"api",...}`: `auth_fail`, `create`, `share`, `role_change`, `unshare`, `trash`, `restore`, `purge` (with `actor`: the user, or `expiry` for the 30-day cleanup) and `migration`.

## Running the pilot (Access mode)

The **Pilot instance** is the copy of Write that other people use. It runs `vite preview` from its own checkout, with its own data, backups and ports, and binds to `127.0.0.1`, so the only way in is through `cloudflared` and Cloudflare Access ([ADR 0005](docs/adr/0005-separate-loopback-pilot-instance.md)). It starts empty.

Your Tailscale **Dev server** (`bun dev` in your usual checkout) doesn't change: it stays in Dev mode, with your data and no sign-in. It is not for pilot users. Don't give them its address, and don't put it behind the tunnel. On tailnet devices, open the pilot through its Access hostname like everyone else. The two can run on the same machine because their ports differ.

The files are in [`deploy/`](deploy):
- `write-pilot.service`: the systemd unit.
- `pilot.env.example`: its settings.
- `cloudflared.example.yml`: the tunnel.
- `pilot-check.ts`: run as `bun run pilot:check`.

The steps below use `write.example.com` for the pilot's hostname, `write-pilot` for the service account, `/opt/write-pilot` for the checkout and `/etc/write-pilot/pilot.env` for the settings.

1. **Create the Access application and policy.** In Cloudflare Zero Trust, go to **Access → Applications** and add a **self-hosted** application for `write.example.com`. Give it an Allow policy that lists the pilot's people, by email or by email domain. Then:
   - **Copy the AUD tag**, the application's "Application Audience (AUD) Tag", and the **team domain**, `<team>.cloudflareaccess.com` (under Zero Trust **Settings**).
   - **Set the cookie's SameSite to Lax** in the application's cookie settings and leave HttpOnly on. The `CF_Authorization` cookie defaults to `None`, which lets other sites send it.
   - **Pick the session duration.** One week is a good default: people sign in about once a week. Write checks the JWT when a socket connects, and an Access JWT stays valid until the session ends. So when you remove someone from the policy, also revoke their session (Zero Trust → **My Team → Users**). Then run `sudo systemctl restart write-pilot` to close their open sockets.
2. **Make a separate checkout.** The service can't see `/home`, so bun and Node (22.12 or later) go in `/usr/local/bin`. The service runs Vite on Node: under Bun's runtime, the collaboration server refuses to start. The checkout is yours. The `write-pilot` account only reads it.
   ```bash
   sudo install -m 755 "$(readlink -f "$(command -v bun)")" /usr/local/bin/bun
   sudo install -m 755 "$(readlink -f "$(command -v node)")" /usr/local/bin/node
   sudo useradd --system --no-create-home --home-dir /var/lib/write-pilot --shell /usr/sbin/nologin write-pilot
   sudo install -d -o "$USER" /opt/write-pilot
   git clone https://github.com/furkan/write.git /opt/write-pilot
   cd /opt/write-pilot && bun install --frozen-lockfile && bun run build
   ```
   Don't put `.env` or `.env.local` files in this checkout, because `vite preview` reads them too.
3. **Fill in the env file.** Copy `deploy/pilot.env.example` and replace each `<...>` with your own values: the hostname, team domain, AUD tag and your email for `WRITE_OWNER_EMAIL`. The ports (4174 and 1235) and the data dirs (under `/var/lib/write-pilot`) can stay as they are. Leave `WRITE_ACCESS_CERTS_URL` and `WRITE_ALLOWED_ORIGINS` unset. Then check the file as the service user:
   ```bash
   sudo install -d -m 750 -g write-pilot /etc/write-pilot
   sudo install -m 640 -g write-pilot deploy/pilot.env.example /etc/write-pilot/pilot.env
   sudoedit /etc/write-pilot/pilot.env
   sudo -u write-pilot /usr/local/bin/bun run pilot:check /etc/write-pilot/pilot.env
   ```
   `pilot:check` reports, among other things:
   - required settings that are missing, and placeholders left in;
   - a collaboration port of 1234 or an app port of 5173 (the Dev server's);
   - a `WRITE_HOST` other than loopback, and a test-only `WRITE_ACCESS_CERTS_URL`;
   - data dirs that aren't writable;
   - a missing build, and `.env` files in the checkout.

   It exits 1 on any error. Until the first start, it warns that `/var/lib/write-pilot` doesn't exist yet; systemd creates it.
4. **Install the systemd unit and enable it.** Fill in the unit's placeholders, then start it:
   ```bash
   sed -e 's|@USER@|write-pilot|g' -e 's|@CHECKOUT@|/opt/write-pilot|g' -e 's|@BUN@|/usr/local/bin/bun|g' \
     deploy/write-pilot.service | sudo tee /etc/systemd/system/write-pilot.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now write-pilot
   ```
   It is a system service with a dedicated account rather than a user service. It starts at boot without anyone logged in, and the sandbox only works under the system manager. The sandbox makes the whole file system read-only except `/var/lib/write-pilot`, hides `/home`, and gives the service a private `/tmp`. The service restarts on failure, and it gives up after five failed starts in two minutes, such as when a setting is missing. On stop it stores open documents before exiting. Logs go to journald.
5. **Run `cloudflared` as a service.** Use a locally managed tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create write-pilot          # prints the tunnel UUID and writes <UUID>.json
   cloudflared tunnel route dns write-pilot write.example.com
   sudo install -d /etc/cloudflared
   sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
   sudo cp deploy/cloudflared.example.yml /etc/cloudflared/config.yml   # then fill in its <...>
   sudo cloudflared service install
   ```
   The config sends `write.example.com` to `http://127.0.0.1:4174` and answers 404 for everything else. It also has `cloudflared` check the Access JWT itself, so that's two checks. WebSockets need no extra settings.

   Leave `httpHostHeader` unset. `cloudflared` then passes the browser's `Host: write.example.com` through to Write:
   - Vite accepts it because it's in `WRITE_ALLOWED_HOSTS`.
   - The Origin check passes because the browser's `Origin: https://write.example.com` matches it, so `WRITE_ALLOWED_ORIGINS` isn't needed.

   If you rewrote Host to `127.0.0.1:4174`, every edit and every collaboration socket would be refused. If you manage the tunnel from the dashboard instead, add the same public hostname and service, and leave **HTTP Host Header** empty.
6. **Verify.**
   - Without a token, the app refuses requests:
     ```bash
     curl -i -H 'Host: write.example.com' http://127.0.0.1:4174/api/me   # 401 {"error":"unauthenticated"}
     curl -I https://write.example.com/                                  # 302 to <team>.cloudflareaccess.com
     ```
   - In a browser, open `https://write.example.com`, sign in, check that the account menu shows your email, create a document and open it in a second browser to see both carets.
   - `journalctl -u write-pilot -b` shows the startup line `[write] Access mode: every request needs a Cloudflare Access JWT for team <team>.cloudflareaccess.com; data in /var/lib/write-pilot/data, collaboration on 127.0.0.1:1235`. If it contains `WARNING: signing keys from`, a test certs URL is set: remove it. Audit lines (`{"audit":"auth_fail",...}`, `create`, `share`, ...) appear in the same log.
7. **Back up, restore and upgrade.**
   - **Backups.** The server snapshots the data dir daily into `/var/lib/write-pilot/backups` and keeps 14 (see [Backups](#backups)). Those copies are on the same disk, so also copy them off the machine now and then, e.g. `sudo rsync -a /var/lib/write-pilot/backups/ <elsewhere>/`.
   - **Restore.** Run `sudo systemctl stop write-pilot`, then copy the snapshot over `/var/lib/write-pilot/data` (`sudo rsync -a --delete <snapshot>/ /var/lib/write-pilot/data/`). Run `sudo chown -R write-pilot: /var/lib/write-pilot/data`, then `sudo systemctl start write-pilot`.
   - **Upgrade.** Note the running commit (`git -C /opt/write-pilot rev-parse HEAD`) and snapshot the data by hand (`sudo cp -a /var/lib/write-pilot/data /var/lib/write-pilot/data-before-<commit>`). Then:
     ```bash
     cd /opt/write-pilot && git pull && bun install --frozen-lockfile && bun run build && sudo systemctl restart write-pilot
     ```
     Check the log as in step 6. Open tabs reconnect on their own.
8. **Roll back.**
   - **A bad upgrade.** Check out the commit you noted, then `bun install --frozen-lockfile && bun run build && sudo systemctl restart write-pilot`. If the upgrade changed the data format (the release notes say so), stop the service and restore the `data-before-<commit>` copy first.
   - **Taking the pilot offline.** Run `sudo systemctl disable --now write-pilot cloudflared`. You can also remove the Access application or its DNS route. `/var/lib/write-pilot` stays on disk until you delete it, and the Dev server is unaffected.

## Backups

When the server starts, and every hour after that, it checks the newest snapshot; if it is a day old or there is none, it copies `.collab-data/` to a timestamped folder in `.collab-backups/` (for example `.collab-backups/2026-11-05T09-30-00Z/`) and keeps the newest 14. Set `WRITE_BACKUP_DIR` to keep them somewhere else, such as another disk. Copies are written to a `.partial` folder first and renamed when complete; incomplete ones are removed.

To restore, stop the server, replace `.collab-data/` with a snapshot (or copy single `.ydoc` files back along with its `index.json`), then start it again.

## How collaboration works

`server/collab.ts` is a Vite plugin that starts a [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server on `127.0.0.1:1234` (`WRITE_COLLAB_PORT`) alongside the dev and preview servers. Browsers connect to `/collab` on the Vite port, and Vite forwards the WebSocket to it, so only port 5173 needs to be reachable. Documents are stored as Yjs updates in `.collab-data/` (`WRITE_DATA_DIR`), which is gitignored. Pending writes are flushed when the dev server stops.

The editor waits for the first sync before it mounts. A brand-new document created from a template is seeded by writing the template straight into the Yjs document, only by its owner and only while it is empty. If the server can't be reached within 4 seconds, the editor opens offline and merges its changes when the connection comes back.

## Patched dependency

`patches/@tiptap%2Fy-tiptap@3.0.12.patch` (applied automatically by `bun install`) fixes a bug in y-tiptap 3.0.12's position tracking. Sometimes an extension's `appendTransaction` makes a structural change in the same dispatch as plain typing; for example, TableOfContents assigns an ID when you type the first letter of a new heading, and Link autolinks a URL typed at the start of a line. In that case y-tiptap compared the editor against a Yjs document that didn't contain the typed text yet and threw "Position tracking requires synchronized editor text". The whole keystroke was then dropped. The patch skips position tracking for that one transaction instead of throwing.

## Project layout

```
server/collab.ts          Hocuspocus server, REST API and Vite plugin
server/auth.ts            Identity: Access JWT verification, Dev mode cookie, Origin check
server/config.ts          WRITE_* settings, read once in vite.config.ts
server/audit.ts           Audit log lines
deploy/                   The pilot: systemd unit, env file, cloudflared config, pilot:check
tests/                    bun test suites: unit tests and the real server in Dev and Access modes
src/App.tsx               Router: library or document
src/pages/Library.tsx     Document library (templates, search, grid and list, actions)
src/pages/DocumentPage.tsx  Editor page: sync gating, roles, template seeding, view state, lost access
src/pages/SignIn.tsx      Sign-in, "can't reach the server" and "signed in again" screens
src/api.ts                Library API client (detects a Session expired)
src/session.ts            The signed-in user (from /api/me), Session expired state, account actions
src/store.ts              A tiny external store that React components can follow
src/identity.ts           Caret label and colour from an email
src/theme.ts              Theme choice (System, Light, Dark)
src/editor/templates.ts   New-document templates
src/editor/extensions.ts  Every extension and its configuration
src/editor/extensions/    Custom extensions (Callout, Spoiler, Shortcuts, SlashCommand, Pagination)
src/editor/page-setup.ts  Page setup (in the shared document) and Print or Web layout (per browser)
src/editor/zoom.ts        Zoom (per browser): percentages and the page fits
src/editor/blocks.tsx     Block insert actions shared by the slash menu, "+" menu and ribbon
src/editor/suggestion/    Popup list used by the slash, mention and emoji menus
src/components/           Menus, sidebar (table of contents), status bar and zoom slider, share dialog, account menu
src/components/ribbon/    The Word-style ribbon (the document page's top bar): title, tabs, groups and their controls
src/tours.ts              Tutorial overlays (driver.js)
```

## Scripts

- `bun dev`: dev server with the collaboration server
- `bun run build`: type-check and production build. Each page and the large libraries (editor, emoji, KaTeX, syntax highlighting, Yjs, React) are separate chunks, so the library page doesn't download the editor
- `bun run preview`: serve the build (collaboration included) in Access mode
- `bun run pilot:check <env file>`: check the pilot's env file and checkout before starting it (see [Running the pilot](#running-the-pilot-access-mode))
- `bun run lint`: oxlint
- `bun run test`: the `bun test` suites. They start real servers on ports 5180/1240 (dev) and 4180/1241 (preview), each from a temporary copy of the project (its `node_modules` linked, not copied) with temporary data dirs (set `WRITE_TEST_TMP` to choose where). So they never change the checkout's files, restart a dev server running from it or touch its data, even though some tests restart their own server by touching its `vite.config.ts` and `.env` files. They need those four ports free. Access mode is tested against a local key server with tokens the tests sign
