# Sharing is invite-by-email only, and no access looks exactly like not found

A document is visible only to its Owner and to the emails on its share list (`editor` or `viewer`). There is no "anyone with the link" access. Every route returns 404, and the collaboration socket returns `permission-denied`, for any document the caller has no role on, whether it exists, belongs to someone else or was purged. Link sharing would add a third access path that listing, revocation and the "not a shared workspace" goal would all have to handle. Uniform 404s mean document IDs, including old guessable `?doc=` names, leak nothing.

## Considered options

- **Invite plus "anyone in the pilot with the link":** rejected for the pilot.
- **Link only:** rejected; it makes every document effectively shared.

## Consequences

- There's no "request access" flow and no notifications. Owners send links themselves, and the link works only for people on the list.
- Collaborators who had a share on a trashed document get a "moved to the trash" message instead of the generic 404 page.
