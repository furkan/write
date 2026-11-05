# Ownership and shares live in index.json, versioned

Each entry in `index.json` gains `owner: string` and `shares: Record<email, 'editor'|'viewer'>`, and the file gains `"version": 2`. We kept a single file (no separate `acl.json`, no SQLite) because it is already written atomically and serially and is already in the daily backups. That leaves one source of truth for both "what exists" and "who can see it", at pilot scale.

## Consequences

- On first load of a version-1 index, a forced backup snapshot is taken, then every entry without an owner is assigned to `WRITE_OWNER_EMAIL`. In Dev mode that defaults to the dev identity; in Access mode it's required when ownerless docs exist. The migration runs once, and only after the collaboration port is bound, so a start that fails (such as an older server still holding the port) changes nothing.
- Purging a document deletes its shares along with the entry. Trashing keeps them.
- Listing and authorization scan the in-memory index. If it grows past pilot scale, it moves to a real database.
