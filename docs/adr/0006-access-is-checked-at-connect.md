# Access is checked when a document connects; access changes drop that document's sockets

The JWT and role are checked in Hocuspocus `onAuthenticate` for each document connection, and in REST middleware for each request, but are not re-checked on a socket that is already open. Whenever the server changes access to a document (share, unshare, role change, trash, restore, purge), it closes every socket on that document (`closeConnections(docId)`), so every client reconnects and is authorized again with its current role. Periodic re-verification would add timers and state for little gain in a pilot.

## Consequences

- Removing a user from the Access policy, or letting their session expire, cuts them off only at their next reconnect or reload.
- Everyone on the document reconnects briefly, not only the affected user. That's accepted for simplicity. After reconnecting, each client announces its presence again, and a presence ID stays with its user while they reconnect, so carets come back and nobody can take someone else's.
- Whoever still may edit after the change loses nothing: Yjs merges what they hadn't synced when they reconnect. Someone demoted to viewer while typing does lose their last edits, because the server refuses them. They stay on that person's screen, with a notice that they weren't saved, until they reload. Someone who loses access gets a read-only page saying why.
- Hocuspocus's own `closeConnections()` only ends the document's session on the socket, and the provider then never retries it, so the server closes the WebSocket itself (code 4205).
- If the server can't check the JWT when a socket connects (Access's signing keys are unavailable), it closes the socket with code 1013 ("Try Again Later") instead of refusing the document, and the client reconnects with a backoff. This is never treated as an expired session.
