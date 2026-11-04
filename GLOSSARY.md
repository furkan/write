# Write

Write is a collaborative document editor run as a private pilot behind Cloudflare Access. It is not a shared workspace: each user sees only their own documents and the ones explicitly shared with them.

## Language

**User**:
A person signed in through Cloudflare Access, identified only by their email, trimmed and lowercased. There are no accounts, passwords or profiles inside Write.
_Avoid_: account, member, principal

**Owner**:
The single user who created a document (or was assigned it by the migration). Only the owner can share it, trash it, restore it or delete it forever.
_Avoid_: author, creator, admin

**Share**:
An owner-granted entry `email → role` on one document. It is the only way anyone but the owner can see a document. It can name someone who has never signed in.
_Avoid_: invite, permission, ACL entry, link share

**Role**:
What a user may do with a document: `owner`, `editor` or `viewer`, or `none` when they have no access. A share carries `editor` or `viewer`; `owner` is never granted by a share.
_Avoid_: permission level, access level

**Editor**:
A user with an `editor` share. They can edit content, rename and duplicate, but not share, trash or delete.
_Avoid_: collaborator (as a role name), writer, contributor

**Viewer**:
A user with a `viewer` share. The server makes their connection read-only. They can still read, export and duplicate.
_Avoid_: reader, guest, commenter

**Collaborator**:
Anyone with a share on a document, whatever their role. Used when talking about "the people a document is shared with", never as a role.
_Avoid_: member, participant

**My documents**:
The library section listing the documents the user owns that are not in the Trash.
_Avoid_: workspace, all documents

**Shared with me**:
The library section listing the documents others have shared with the user, with each owner's email.
_Avoid_: team documents, shared drive

**Remove from my list**:
A collaborator deleting their own share on a document. The document is unaffected, and only the owner can share it with them again.
_Avoid_: leave, unshare (unsharing is the owner's action)

**Trash**:
The owner's per-user holding area for documents they moved there. Restorable for 30 days, then purged. A trashed document's shares are kept but inactive: collaborators lose access until it is restored.
_Avoid_: recycle bin, archive, soft delete

**Delete forever**:
Purging a trashed document, by hand, by emptying the Trash or after 30 days. Its file, index entry and shares are removed, and its ID becomes a Tombstone.
_Avoid_: hard delete, destroy

**Tombstone**:
A purged document ID kept in `index.json` so that no open tab or stale link can ever sync or recreate it.
_Avoid_: deleted marker

**No access**:
What every user without a role on a document sees, whether it never existed, belongs to someone else or was purged: a 404 and the same "doesn't exist or hasn't been shared with you" page.
_Avoid_: forbidden, 403

**Access mode**:
The auth mode under `vite preview`: every REST request and collaboration connection must carry a valid Cloudflare Access JWT. The pilot always runs in this mode.
_Avoid_: prod mode, secure mode

**Dev mode**:
The auth mode under `vite dev`: identity comes from the `write-dev-user` cookie or `WRITE_DEV_USER`, with no verification. It never applies to `vite preview`.
_Avoid_: anonymous mode, no-auth mode

**Pilot instance**:
The separate, loopback-bound `vite preview` deployment, with its own checkout, data dir and ports, reached only through `cloudflared` and Access.
_Avoid_: prod server, the server

**Dev server**:
The human's `vite dev` in `~/Desktop/write` (ports 5173/1234), reached over Tailscale in Dev mode. Agents never touch it or its data.
_Avoid_: staging, local server

**Session expired**:
The state when Access no longer accepts the browser's cookie: fetches get an Access redirect and the collaboration socket can't authenticate. The user signs in again in a new tab, and the open tab keeps and later merges its edits.
_Avoid_: logged out, disconnected (a plain network drop is not a session expiry)

**Caret label**:
The name shown on a user's cursor and in presence: the part of their email before `@`, not editable, with a color derived from the email. The full email appears in the share dialog, account menu and caret tooltip.
_Avoid_: nickname, display name (there is no editable name)

**Legacy owner**:
`WRITE_OWNER_EMAIL`, the user assigned to every document that existed before ownership (index version 1) during the one-time migration.
_Avoid_: default owner, admin
