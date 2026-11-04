/**
 * Audit log: one JSON line on stdout per security event, so journald (under the pilot's
 * systemd unit) keeps it with the rest of the server log. Find them with
 * `journalctl -u <unit> | grep '"audit"'`.
 *
 * Events: `auth_fail` now; `create`, `share`, `unshare`, `role_change`, `trash`, `restore`,
 * `purge` and `migration` as those features land.
 */

export type AuditEvent =
  | 'auth_fail'
  | 'create'
  | 'share'
  | 'unshare'
  | 'role_change'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'migration'

export function audit(event: AuditEvent, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...fields }))
}
