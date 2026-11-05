# The pilot is a separate, loopback-bound instance; Tailscale stays the dev server

The pilot runs from its own checkout as `vite preview`, with its own `WRITE_DATA_DIR`, backups and ports (including a different `WRITE_COLLAB_PORT`). It binds to `127.0.0.1` and is reached only through `cloudflared` → Access. The human's Tailscale `vite dev` server in `~/Desktop/write` stays as it is. Because the pilot is bound to loopback, nothing can reach it over Tailscale or the LAN without Access. Keeping the instances apart means pilot users never see pre-ownership data, and dev mode never faces the internet.

## Consequences

- The pilot starts empty; the human moves documents across by export and import.
- Both instances may run on one machine. Vite uses `strictPort`, and a busy collab port stops startup with a clear error instead of silently moving or sharing ports.
- On tailnet devices, people reach the pilot through the Access hostname like everyone else.
