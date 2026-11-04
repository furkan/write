# Access is checked when a document connects; access changes drop that document's sockets

The JWT and role are checked in Hocuspocus `onAuthenticate` for each document connection, and in REST middleware for each request, but are not re-checked on a socket that is already open. Whenever the server changes access to a document (unshare, role change, trash, purge), it calls `closeConnections(docId)`, so every client reconnects and is authorized again. Yjs merges on reconnect, so nothing is lost. Periodic re-verification would add timers and state for little gain in a pilot.

## Consequences

- Removing a user from the Access policy, or letting their session expire, cuts them off only at their next reconnect or reload.
- Everyone on the document reconnects briefly, not only the affected user. That's accepted for simplicity.
