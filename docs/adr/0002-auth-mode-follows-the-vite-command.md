# The Vite command decides the auth mode, and Access mode fails closed

`vite dev` always uses Dev mode (an unverified identity from a cookie or `WRITE_DEV_USER`). `vite preview` always uses Access mode and refuses to start without `WRITE_ACCESS_TEAM_DOMAIN` and `WRITE_ACCESS_AUD`. There is no env-var fallback to Dev mode. Falling back when the variables are unset would fail open: one variable missing from the systemd unit would make the pilot unauthenticated. Tying the mode to the command leaves nothing to forget.

## Consequences

- The pilot cannot be run with `vite dev`, and the Dev server can never be the instance the internet reaches.
- End-to-end tests of Access mode use `WRITE_ACCESS_CERTS_URL` to point the JWKS at a local key server. `iss` and `aud` are still checked, so this is not a weaker mode.
