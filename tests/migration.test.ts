/**
 * The one-time migration of a version-1 `index.json` (from before ownership) in Dev mode:
 * forced backup, Legacy owner, version 2, orphan files never served, and idempotence.
 * Access mode's refusal without `WRITE_OWNER_EMAIL` is in `access-mode.test.ts`.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { cp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { docFileName } from '../server/collab.ts'
import {
  api,
  DEV_PORTS,
  exitCodeWithin,
  openDocument,
  readText,
  spawnServer,
  startServer,
  tempDir,
  writeV1Fixture,
  type RunningServer,
  type V1Fixture,
} from './helpers.ts'

type Index = {
  version: number
  docs: Record<string, { owner: string; shares: object; trashedAt?: number; title: string }>
  deleted: Record<string, string>
}
const readIndex = async (dataDir: string) => JSON.parse(await readFile(join(dataDir, 'index.json'), 'utf8')) as Index

const as = (server: RunningServer, email: string) => ({ cookie: `write-dev-user=${email}`, origin: server.url })
const auditLines = (server: RunningServer, event: string) =>
  server
    .output()
    .split('\n')
    .filter((line) => line.startsWith(`{"audit":"${event}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>)

const scratch: string[] = []
afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true })
})

describe('migrating a version-1 index in Dev mode', () => {
  let fixture: V1Fixture
  let server: RunningServer
  let keep: string

  test('the dev identity becomes the Legacy owner, after a forced backup', async () => {
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: { WRITE_DEV_USER: 'Me@X.com' },
      seed: async (dataDir) => {
        fixture = await writeV1Fixture(dataDir)
      },
    })
    try {
      const index = await readIndex(server.dataDir)
      expect(index.version).toBe(2)
      expect(index.docs['legacy-one']).toMatchObject({ owner: 'me@x.com', shares: {}, title: 'Legacy one' })
      expect(index.docs['legacy-trashed']).toMatchObject({ owner: 'me@x.com', shares: {} })
      expect(index.deleted).toEqual({ 'legacy-gone': 'me@x.com' })
      expect(Object.keys(index.docs)).not.toContain('orphan-doc')

      // The backup holds the data exactly as it was before the migration.
      const snapshots = await readdir(server.backupDir)
      expect(snapshots).toHaveLength(1)
      expect(await readFile(join(server.backupDir, snapshots[0], 'index.json'), 'utf8')).toBe(fixture.indexText)

      const [migration] = auditLines(server, 'migration')
      expect(migration).toMatchObject({ from: 1, to: 2, owner: 'me@x.com', assigned: 2, tombstones: 1 })
      expect(String(migration.backup)).toContain(snapshots[0])

      // The owner has everything as before.
      const me = as(server, 'me@x.com')
      const ws = `ws://127.0.0.1:${server.port}/collab`
      const list = (await api(server, '/api/docs', { headers: me })).body?.docs as { id: string; role: string }[]
      expect(list.map((doc) => [doc.id, doc.role])).toEqual([['legacy-one', 'owner']])
      const trash = (await api(server, '/api/trash', { headers: me })).body?.docs as { id: string }[]
      expect(trash.map((doc) => doc.id)).toEqual(['legacy-trashed'])
      expect(await readText(ws, 'legacy-one', me)).toContain('legacy content')
      expect((await api(server, '/api/docs/legacy-gone/status', { headers: me })).body).toEqual({
        access: 'none',
        trashed: false,
        deleted: true,
      })

      // Nobody else does.
      const other = as(server, 'other@x.com')
      expect((await api(server, '/api/docs', { headers: other })).body?.docs).toEqual([])
      expect((await api(server, '/api/docs/legacy-one', { headers: other })).status).toBe(404)
      expect(await openDocument(ws, 'legacy-one', other)).toEqual({ status: 'denied', reason: 'permission-denied' })

      // An orphan file is never served, to anyone, and stays on disk.
      expect(await openDocument(ws, 'orphan-doc', me)).toEqual({ status: 'denied', reason: 'permission-denied' })
      expect((await api(server, '/api/docs/orphan-doc', { headers: me })).status).toBe(404)
      expect((await api(server, '/api/docs/orphan-doc/duplicate', { method: 'POST', headers: me })).status).toBe(404)
      expect(await readdir(server.dataDir)).toContain(docFileName('orphan-doc'))

      keep = await tempDir('migrated-')
      scratch.push(keep)
      await cp(server.dataDir, keep, { recursive: true })
    } finally {
      await server.stop()
    }
  }, 30_000)

  test('runs once: a version-2 index is loaded as is', async () => {
    const again = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      // A different dev identity must not take over anything.
      env: { WRITE_DEV_USER: 'someone-else@x.com' },
      seed: (dataDir) => cp(keep, dataDir, { recursive: true }),
    })
    try {
      expect(auditLines(again, 'migration')).toEqual([])
      const index = await readIndex(again.dataDir)
      expect(index.docs['legacy-one'].owner).toBe('me@x.com')
      expect((await api(again, '/api/docs', { headers: as(again, 'someone-else@x.com') })).body?.docs).toEqual([])
    } finally {
      await again.stop()
    }
  }, 30_000)

  test('WRITE_OWNER_EMAIL wins over the dev identity, normalised', async () => {
    const server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      env: { WRITE_DEV_USER: 'me@x.com', WRITE_OWNER_EMAIL: '  Owner@X.com ' },
      seed: async (dataDir) => void (await writeV1Fixture(dataDir)),
    })
    try {
      const index = await readIndex(server.dataDir)
      expect(index.docs['legacy-one'].owner).toBe('owner@x.com')
      expect((await api(server, '/api/docs/legacy-one/status', { headers: as(server, 'owner@x.com') })).body?.access).toBe(
        'owner',
      )
      expect((await api(server, '/api/docs/legacy-one/status', { headers: as(server, 'me@x.com') })).body?.access).toBe(
        'none',
      )
    } finally {
      await server.stop()
    }
  }, 30_000)

  test('a corrupt index stops the server instead of being overwritten', async () => {
    let dataDir = ''
    const server = await spawnServer({
      command: 'dev',
      ...DEV_PORTS,
      seed: async (dir) => {
        dataDir = dir
        await Bun.write(join(dir, 'index.json'), '{"docs": {"half-writ')
      },
    })
    const code = await Promise.race([server.exited, Bun.sleep(15_000).then(() => 'timeout' as const)])
    try {
      expect(code).not.toBe('timeout')
      expect(code).not.toBe(0)
      expect(server.output()).toContain('is not valid JSON')
      expect(await readFile(join(dataDir, 'index.json'), 'utf8')).toBe('{"docs": {"half-writ')
    } finally {
      await exitCodeWithin(server, 1000)
    }
  }, 20_000)
})
