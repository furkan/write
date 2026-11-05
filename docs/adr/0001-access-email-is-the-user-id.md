# The Cloudflare Access email is the user ID

Write has no accounts of its own. Every user is the `email` claim of the verified `Cf-Access-Jwt-Assertion` JWT, trimmed and lowercased, and that string is stored as `owner` and as the key of every share. We chose email over the stable Access `sub` UUID because sharing has to work for people who have never signed in (we don't know their `sub` yet), because Access policies are written in emails, and because the data stays readable to humans.

## Consequences

- If a user's email changes at the identity provider, they lose their documents until an admin rewrites `index.json`. Accepted for the pilot.
- Service tokens, whose JWTs carry no `email`, are rejected with 403.
- Moving to `sub` later means migrating every owner and share.
