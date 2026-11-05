/**
 * Ownership, roles, sharing and the per-owner Trash, end to end in Dev mode (`vite` on
 * 5180/1240), with several users picked by the `write-dev-user` cookie:
 * alice owns the documents, bob is an editor, carol a viewer and mallory a stranger.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { docFileName } from '../server/collab.ts'
import {
  api,
  connectDocument,
  DEV_PORTS,
  openDocument,
  readText,
  startServer,
  typeParagraph,
  type LiveDocument,
  type RunningServer,
} from './helpers.ts'

let server: RunningServer
let ws: string
const live: LiveDocument[] = []

beforeAll(async () => {
  server = await startServer({ command: 'dev', ...DEV_PORTS })
  ws = `ws://127.0.0.1:${server.port}/collab`
}, 30_000)
afterAll(async () => {
  for (const connection of live) connection.destroy()
  await server?.stop()
})

const as = (email: string) => ({ cookie: `write-dev-user=${encodeURIComponent(email)}`, origin: server.url })
const ALICE = 'alice@x.com'
const BOB = 'bob@x.com'
const CAROL = 'carol@x.com'
const MALLORY = 'mallory@x.com'

type Init = { method?: string; body?: unknown }
const call = (email: string, path: string, { method = 'GET', body }: Init = {}) =>
  api(server, path, {
    method,
    headers: { ...as(email), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const enc = encodeURIComponent
const share = (owner: string, id: string, email: string, role: string) =>
  call(owner, `/api/docs/${enc(id)}/shares/${enc(email)}`, { method: 'PUT', body: { role } })
const unshare = (actor: string, id: string, email: string) =>
  call(actor, `/api/docs/${enc(id)}/shares/${enc(email)}`, { method: 'DELETE' })

async function create(owner: string, title = '') {
  const { status, body } = await call(owner, '/api/docs', { method: 'POST', body: { title } })
  expect(status).toBe(201)
  return String(body?.id)
}

async function connect(email: string, id: string) {
  const connection = await connectDocument(ws, id, as(email))
  live.push(connection)
  return connection
}

/** IDs in a listing (`/api/docs` or `/api/trash`) as `email` sees it. */
const idsIn = async (email: string, path: string) => {
  const { body } = await call(email, path)
  return ((body?.docs ?? []) as { id: string }[]).map((doc) => doc.id)
}
const listIds = (email: string) => idsIn(email, '/api/docs')

/** alice's document shared with bob (editor) and carol (viewer), with some text in it. */
async function sharedDoc(title = 'Shared plan') {
  const id = await create(ALICE, title)
  const writer = await connect(ALICE, id)
  typeParagraph(writer.doc, 'original text')
  await Bun.sleep(300)
  writer.destroy()
  expect((await share(ALICE, id, BOB, 'editor')).status).toBe(200)
  expect((await share(ALICE, id, CAROL, 'viewer')).status).toBe(200)
  return id
}

describe('roles on every route', () => {
  let id: string
  beforeAll(async () => {
    id = await sharedDoc()
  })

  test('the list holds own documents and those shared with you, with role and owner', async () => {
    const mine = (await call(ALICE, '/api/docs')).body?.docs as Record<string, unknown>[]
    expect(mine.find((doc) => doc.id === id)).toMatchObject({
      owner: ALICE,
      role: 'owner',
      shares: { [BOB]: 'editor', [CAROL]: 'viewer' },
      title: 'Shared plan',
    })
    for (const [email, role] of [
      [BOB, 'editor'],
      [CAROL, 'viewer'],
    ]) {
      const docs = (await call(email, '/api/docs')).body?.docs as Record<string, unknown>[]
      const item = docs.find((doc) => doc.id === id)
      expect(item).toMatchObject({ owner: ALICE, role })
      // Shares are listed for the owner only.
      expect(item).not.toHaveProperty('shares')
    }
    expect(await listIds(MALLORY)).not.toContain(id)
  })

  test('GET /:id shows owner and shares to everyone with access', async () => {
    for (const [email, role] of [
      [ALICE, 'owner'],
      [BOB, 'editor'],
      [CAROL, 'viewer'],
    ]) {
      const { status, body } = await call(email, `/api/docs/${id}`)
      expect(status).toBe(200)
      expect(body).toMatchObject({ id, owner: ALICE, role, shares: { [BOB]: 'editor', [CAROL]: 'viewer' } })
    }
    expect(await call(MALLORY, `/api/docs/${id}`)).toEqual({ status: 404, body: { error: 'not found' } })
  })

  test('status names the role, and only that', async () => {
    expect((await call(ALICE, `/api/docs/${id}/status`)).body).toEqual({ access: 'owner', trashed: false, deleted: false })
    expect((await call(BOB, `/api/docs/${id}/status`)).body).toEqual({ access: 'editor', trashed: false, deleted: false })
    expect((await call(CAROL, `/api/docs/${id}/status`)).body).toEqual({ access: 'viewer', trashed: false, deleted: false })
    expect(await call(MALLORY, `/api/docs/${id}/status`)).toEqual({
      status: 200,
      body: { access: 'none', trashed: false, deleted: false },
    })
  })

  test('rename: owner and editor yes, viewer 403, stranger 404', async () => {
    expect((await call(ALICE, `/api/docs/${id}`, { method: 'PATCH', body: { title: 'By alice' } })).body).toMatchObject({
      title: 'By alice',
      role: 'owner',
    })
    expect((await call(BOB, `/api/docs/${id}`, { method: 'PATCH', body: { title: 'By bob' } })).body).toMatchObject({
      title: 'By bob',
      role: 'editor',
    })
    expect((await call(CAROL, `/api/docs/${id}`, { method: 'PATCH', body: { title: 'By carol' } })).status).toBe(403)
    expect((await call(MALLORY, `/api/docs/${id}`, { method: 'PATCH', body: { title: 'By mallory' } })).status).toBe(404)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.title).toBe('By bob')
  })

  test('duplicate: anyone with access; the copy is theirs, with no shares', async () => {
    for (const email of [ALICE, BOB, CAROL]) {
      const { status, body } = await call(email, `/api/docs/${id}/duplicate`, { method: 'POST' })
      expect(status).toBe(201)
      expect(body).toMatchObject({ owner: email, role: 'owner', shares: {} })
      expect(String(body?.title)).toStartWith('Copy of ')
      expect(await readText(ws, String(body?.id), as(email))).toContain('original text')
      // Nobody else sees the copy.
      for (const other of [ALICE, BOB, CAROL].filter((x) => x !== email)) {
        expect(await listIds(other)).not.toContain(body?.id)
      }
    }
    expect((await call(MALLORY, `/api/docs/${id}/duplicate`, { method: 'POST' })).status).toBe(404)
  })

  test('only the owner may trash, share or change roles', async () => {
    for (const email of [BOB, CAROL]) {
      expect((await call(email, `/api/docs/${id}`, { method: 'DELETE' })).status).toBe(403)
      expect((await share(email, id, 'dan@x.com', 'viewer')).status).toBe(403)
      expect((await share(email, id, CAROL, 'editor')).status).toBe(403)
    }
    // An editor can't remove someone else's share.
    expect((await unshare(BOB, id, CAROL)).status).toBe(403)
    expect((await unshare(CAROL, id, BOB)).status).toBe(403)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.shares).toEqual({ [BOB]: 'editor', [CAROL]: 'viewer' })
    expect((await call(ALICE, `/api/docs/${id}/status`)).body?.trashed).toBe(false)
  })

  test('the collaboration socket: read-write for owner and editor, read-only for the viewer', async () => {
    expect((await connect(ALICE, id)).events).toContain('authenticated:read-write')
    expect((await connect(BOB, id)).events).toContain('authenticated:read-write')
    expect((await connect(CAROL, id)).events).toContain('authenticated:readonly')
    expect(await openDocument(ws, id, as(MALLORY))).toEqual({ status: 'denied', reason: 'permission-denied' })
  })

  test("the server drops a viewer's edits and keeps an editor's", async () => {
    const watcher = await connect(ALICE, id)
    const viewer = await connect(CAROL, id)
    const editor = await connect(BOB, id)
    typeParagraph(viewer.doc, 'written by the viewer')
    typeParagraph(editor.doc, 'written by the editor')
    await Bun.sleep(1500)
    const seen = watcher.doc.getXmlFragment('default').toString()
    expect(seen).toContain('written by the editor')
    expect(seen).not.toContain('written by the viewer')
    // And it isn't stored either: a fresh connection doesn't have it.
    const stored = await readText(ws, id, as(ALICE))
    expect(stored).toContain('written by the editor')
    expect(stored).not.toContain('written by the viewer')
    // The viewer's own copy keeps its local edit, but nothing else ever gets it.
    expect(viewer.doc.getXmlFragment('default').toString()).toContain('written by the viewer')
  })
})

describe('a stranger learns nothing', () => {
  let id: string
  let purgedId: string
  beforeAll(async () => {
    id = await sharedDoc()
    purgedId = await create(ALICE)
    await call(ALICE, `/api/docs/${purgedId}`, { method: 'DELETE' })
    await call(ALICE, `/api/trash/${purgedId}`, { method: 'DELETE' })
  })

  const routes = (target: string): [string, Init][] => [
    [`/api/docs/${target}`, {}],
    [`/api/docs/${target}`, { method: 'PATCH', body: { title: 'x' } }],
    [`/api/docs/${target}`, { method: 'DELETE' }],
    [`/api/docs/${target}/duplicate`, { method: 'POST' }],
    [`/api/docs/${target}/status`, {}],
    [`/api/docs/${target}/shares/${enc(MALLORY)}`, { method: 'PUT', body: { role: 'editor' } }],
    [`/api/docs/${target}/shares/${enc(BOB)}`, { method: 'DELETE' }],
    [`/api/docs/${target}/shares/${enc(MALLORY)}`, { method: 'DELETE' }],
    [`/api/trash/${target}/restore`, { method: 'POST' }],
    [`/api/trash/${target}`, { method: 'DELETE' }],
  ]

  test('an existing document, a purged one and one that never existed answer alike', async () => {
    for (const [index, [path, init]] of routes(id).entries()) {
      const existing = await call(MALLORY, path, init)
      const never = await call(MALLORY, routes('never-existed-0000')[index][0], init)
      const purged = await call(MALLORY, routes(purgedId)[index][0], init)
      expect({ path, ...existing }).toEqual({ path, ...never })
      expect({ path, ...purged }).toEqual({ path, ...never })
      expect(existing.status === 404 || path.endsWith('/status')).toBe(true)
    }
    // Nothing changed for alice.
    expect((await call(ALICE, `/api/docs/${id}`)).body).toMatchObject({
      title: 'Shared plan',
      shares: { [BOB]: 'editor', [CAROL]: 'viewer' },
    })
    expect((await call(ALICE, `/api/docs/${id}/status`)).body?.trashed).toBe(false)
  })

  test('the socket refuses them all the same way', async () => {
    for (const target of [id, purgedId, 'never-existed-0000']) {
      expect(await openDocument(ws, target, as(MALLORY))).toEqual({ status: 'denied', reason: 'permission-denied' })
    }
  })

  test('the Trash of others is invisible', async () => {
    const trashed = await create(ALICE)
    await call(ALICE, `/api/docs/${trashed}`, { method: 'DELETE' })
    for (const email of [BOB, MALLORY]) {
      expect(await idsIn(email, '/api/trash')).not.toContain(trashed)
    }
    expect(await idsIn(ALICE, '/api/trash')).toContain(trashed)
  })
})

describe('documents are created only by POST', () => {
  test('a ?doc= name that is not in the index is refused, and nothing is created', async () => {
    const name = 'made-up-by-a-link'
    expect(await openDocument(ws, name, as(ALICE))).toEqual({ status: 'denied', reason: 'permission-denied' })
    await Bun.sleep(700)
    expect(await readdir(server.dataDir)).not.toContain(docFileName(name))
    const index = JSON.parse(await readFile(join(server.dataDir, 'index.json'), 'utf8')) as { docs: object }
    expect(Object.keys(index.docs)).not.toContain(name)
    expect((await call(ALICE, `/api/docs/${name}/status`)).body).toEqual({ access: 'none', trashed: false, deleted: false })
  })

  test('names that look like built-in properties are not documents', async () => {
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect((await call(ALICE, `/api/docs/${name}`)).status).toBe(404)
      expect((await call(ALICE, `/api/docs/${name}/status`)).body?.access).toBe('none')
    }
    // Hocuspocus 4.8 itself trips over such names before any hook runs (it looks them up in a
    // plain object), so the socket never answers; what matters is that it never syncs.
    expect((await openDocument(ws, 'constructor', as(ALICE))).status).not.toBe('synced')
    expect((await call(ALICE, '/api/me')).status).toBe(200)
  }, 10_000)

  test('the new document belongs to its creator, with no shares, in index version 2', async () => {
    const id = await create(BOB, 'Bob’s notes')
    const index = JSON.parse(await readFile(join(server.dataDir, 'index.json'), 'utf8')) as {
      version: number
      docs: Record<string, { owner: string; shares: object }>
    }
    expect(index.version).toBe(2)
    expect(index.docs[id]).toMatchObject({ owner: BOB, shares: {} })
    expect(server.output()).toContain(`"audit":"create"`)
  })
})

describe('sharing', () => {
  test('emails are normalised: Bob@X.com is bob@x.com', async () => {
    const id = await create(ALICE)
    const { body } = await share(ALICE, id, '  Bob@X.com ', 'viewer')
    expect(body?.shares).toEqual({ [BOB]: 'viewer' })
    // The same user however their address is cased.
    expect((await call('BOB@x.COM', `/api/docs/${id}/status`)).body?.access).toBe('viewer')
    expect((await share(ALICE, id, 'BOB@x.com', 'editor')).body?.shares).toEqual({ [BOB]: 'editor' })
    expect((await unshare(ALICE, id, 'bOb@X.cOm')).status).toBe(204)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.shares).toEqual({})
  })

  test('validation: email, role, the owner themselves', async () => {
    const id = await create(ALICE)
    for (const email of ['not-an-email', 'a@b@c', 'two words@x.com']) {
      expect((await share(ALICE, id, email, 'viewer')).status).toBe(400)
    }
    for (const role of ['owner', 'admin', '']) {
      expect((await share(ALICE, id, BOB, role)).status).toBe(400)
    }
    expect((await call(ALICE, `/api/docs/${id}/shares/${enc(BOB)}`, { method: 'PUT' })).status).toBe(400)
    expect((await share(ALICE, id, ALICE, 'editor')).status).toBe(400)
    expect((await share(ALICE, id, 'Alice@X.com', 'viewer')).status).toBe(400)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.shares).toEqual({})
  })

  test('someone who has never signed in can be shared with', async () => {
    const id = await create(ALICE)
    expect((await share(ALICE, id, 'newcomer@x.com', 'editor')).status).toBe(200)
    expect((await call('newcomer@x.com', `/api/docs/${id}/status`)).body?.access).toBe('editor')
  })

  test('at most 50 shares per document', async () => {
    const id = await create(ALICE)
    for (let i = 0; i < 50; i++) expect((await share(ALICE, id, `user${i}@x.com`, 'viewer')).status).toBe(200)
    const over = await share(ALICE, id, 'user50@x.com', 'viewer')
    expect(over.status).toBe(409)
    expect(String(over.body?.error)).toContain('50')
    // Changing a role at the cap is not a new share.
    expect((await share(ALICE, id, 'user0@x.com', 'editor')).status).toBe(200)
    expect(Object.keys((await call(ALICE, `/api/docs/${id}`)).body?.shares as object)).toHaveLength(50)
    expect((await call('user50@x.com', `/api/docs/${id}/status`)).body?.access).toBe('none')
  })

  test('share, role change and unshare are audited', async () => {
    const id = await create(ALICE)
    await share(ALICE, id, 'dan@x.com', 'viewer')
    await share(ALICE, id, 'dan@x.com', 'editor')
    await unshare(ALICE, id, 'dan@x.com')
    const lines = server
      .output()
      .split('\n')
      .filter((line) => line.includes(`"doc":"${id}"`))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map((line) => line.audit)).toEqual(['create', 'share', 'role_change', 'unshare'])
    expect(lines[2]).toMatchObject({ actor: ALICE, email: 'dan@x.com', role: 'editor', from: 'viewer' })
  })

  test('a new share opens the socket to that user', async () => {
    const id = await create(ALICE)
    expect(await openDocument(ws, id, as('dan@x.com'))).toEqual({ status: 'denied', reason: 'permission-denied' })
    await share(ALICE, id, 'dan@x.com', 'editor')
    expect(await openDocument(ws, id, as('dan@x.com'))).toEqual({ status: 'synced' })
  })

  test('access changes disconnect open sockets, which reconnect with their new role', async () => {
    const id = await sharedDoc()
    const owner = await connect(ALICE, id)
    const editor = await connect(BOB, id)
    const viewer = await connect(CAROL, id)

    // Promote carol: everyone reconnects; carol is now read-write.
    let mark = [owner, editor, viewer].map((c) => c.events.length)
    await share(ALICE, id, CAROL, 'editor')
    await viewer.waitFor(/^close$/, { from: mark[2] })
    await viewer.waitFor(/^authenticated:read-write$/, { from: mark[2] })
    await viewer.waitFor(/^synced$/, { from: mark[2] })
    await editor.waitFor(/^synced$/, { from: mark[1] })
    await owner.waitFor(/^synced$/, { from: mark[0] })
    typeParagraph(viewer.doc, 'carol can write now')
    await Bun.sleep(800)
    expect(owner.doc.getXmlFragment('default').toString()).toContain('carol can write now')

    // Demote bob: his reconnect is read-only.
    mark = [owner, editor, viewer].map((c) => c.events.length)
    await share(ALICE, id, BOB, 'viewer')
    await editor.waitFor(/^authenticated:readonly$/, { from: mark[1] })

    // Unshare carol: her reconnect is refused; bob's still works.
    mark = [owner, editor, viewer].map((c) => c.events.length)
    await unshare(ALICE, id, CAROL)
    await viewer.waitFor(/^denied:permission-denied$/, { from: mark[2] })
    await editor.waitFor(/^synced$/, { from: mark[1] })
    expect(editor.events.slice(mark[1])).not.toContain('denied:permission-denied')
  }, 30_000)
})

describe('Remove from my list', () => {
  test('a collaborator deletes their own share and loses access', async () => {
    const id = await sharedDoc()
    const socket = await connect(BOB, id)
    const mark = socket.events.length
    expect((await unshare(BOB, id, 'BOB@x.com')).status).toBe(204)
    await socket.waitFor(/^denied:permission-denied$/, { from: mark })
    expect(await listIds(BOB)).not.toContain(id)
    expect((await call(BOB, `/api/docs/${id}`)).status).toBe(404)
    expect((await call(BOB, `/api/docs/${id}/status`)).body?.access).toBe('none')
    // Nothing else changed.
    expect((await call(ALICE, `/api/docs/${id}`)).body?.shares).toEqual({ [CAROL]: 'viewer' })
    expect((await call(CAROL, `/api/docs/${id}/status`)).body?.access).toBe('viewer')
    // Removing it again: no access any more, so 404.
    expect((await unshare(BOB, id, BOB)).status).toBe(404)
    // Only the owner can share it with them again.
    expect((await share(ALICE, id, BOB, 'viewer')).status).toBe(200)
    expect((await call(BOB, `/api/docs/${id}/status`)).body?.access).toBe('viewer')
  })
})

describe('the Trash belongs to the owner', () => {
  test('trash keeps the shares inactive, restore brings them back', async () => {
    const id = await sharedDoc('Trashed plan')
    const editor = await connect(BOB, id)
    const viewer = await connect(CAROL, id)
    const marks = [editor.events.length, viewer.events.length]

    expect((await call(ALICE, `/api/docs/${id}`, { method: 'DELETE' })).status).toBe(204)
    await editor.waitFor(/^denied:permission-denied$/, { from: marks[0] })
    await viewer.waitFor(/^denied:permission-denied$/, { from: marks[1] })

    // Collaborators learn it was trashed; strangers learn nothing; only the owner can restore.
    expect((await call(ALICE, `/api/docs/${id}/status`)).body).toEqual({ access: 'owner', trashed: true, deleted: false })
    expect((await call(BOB, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: true, deleted: false })
    expect((await call(CAROL, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: true, deleted: false })
    expect((await call(MALLORY, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: false, deleted: false })
    for (const email of [ALICE, BOB, CAROL]) {
      expect(await listIds(email)).not.toContain(id)
      expect((await call(email, `/api/docs/${id}`)).status).toBe(404)
      expect(await openDocument(ws, id, as(email))).toEqual({ status: 'denied', reason: 'permission-denied' })
    }
    // Shares can't be used, changed or removed while trashed.
    expect((await unshare(BOB, id, BOB)).status).toBe(404)
    expect((await share(ALICE, id, 'dan@x.com', 'viewer')).status).toBe(404)
    // Trashing again is fine.
    expect((await call(ALICE, `/api/docs/${id}`, { method: 'DELETE' })).status).toBe(204)

    const trash = (await call(ALICE, '/api/trash')).body?.docs as Record<string, unknown>[]
    expect(trash.find((doc) => doc.id === id)).toMatchObject({ owner: ALICE, shares: { [BOB]: 'editor', [CAROL]: 'viewer' } })
    for (const email of [BOB, CAROL, MALLORY]) {
      expect((await call(email, `/api/trash/${id}/restore`, { method: 'POST' })).status).toBe(404)
      expect((await call(email, `/api/trash/${id}`, { method: 'DELETE' })).status).toBe(404)
    }

    const restored = await call(ALICE, `/api/trash/${id}/restore`, { method: 'POST' })
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ id, shares: { [BOB]: 'editor', [CAROL]: 'viewer' } })
    expect(restored.body).not.toHaveProperty('trashedAt')
    expect((await call(BOB, `/api/docs/${id}/status`)).body?.access).toBe('editor')
    expect(await listIds(CAROL)).toContain(id)
    expect(await readText(ws, id, as(BOB))).toContain('original text')
    const audits = server.output().split('\n').filter((line) => line.includes(`"doc":"${id}"`))
    expect(audits.some((line) => line.includes('"audit":"trash"'))).toBe(true)
    expect(audits.some((line) => line.includes('"audit":"restore"'))).toBe(true)
  })

  test('delete forever removes the shares and tombstones the ID', async () => {
    const id = await sharedDoc()
    await call(ALICE, `/api/docs/${id}`, { method: 'DELETE' })
    expect((await call(ALICE, `/api/trash/${id}`, { method: 'DELETE' })).status).toBe(204)

    expect((await call(ALICE, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: false, deleted: true })
    for (const email of [BOB, CAROL, MALLORY]) {
      expect((await call(email, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: false, deleted: false })
    }
    for (const email of [ALICE, BOB]) {
      expect(await openDocument(ws, id, as(email))).toEqual({ status: 'denied', reason: 'permission-denied' })
      expect((await call(email, `/api/docs/${id}`)).status).toBe(404)
    }
    const index = JSON.parse(await readFile(join(server.dataDir, 'index.json'), 'utf8')) as {
      docs: object
      deleted: Record<string, string>
    }
    expect(index.docs).not.toHaveProperty(id)
    expect(index.deleted[id]).toBe(ALICE)
    expect(await readdir(server.dataDir)).not.toContain(docFileName(id))
    expect(server.output()).toContain(`"audit":"purge"`)
  })

  test('emptying the Trash skips IDs that are not your own trashed documents', async () => {
    const alices = await sharedDoc()
    const alicesOpen = await create(ALICE)
    const bobs = await create(BOB)
    await call(ALICE, `/api/docs/${alices}`, { method: 'DELETE' })
    await call(BOB, `/api/docs/${bobs}`, { method: 'DELETE' })

    const emptied = await call(BOB, '/api/trash', { method: 'DELETE', body: { ids: [alices, alicesOpen, bobs, 'nope'] } })
    expect(emptied).toEqual({ status: 200, body: { purged: 1 } })
    expect((await call(BOB, `/api/docs/${bobs}/status`)).body?.deleted).toBe(true)
    expect((await call(ALICE, `/api/docs/${alices}/status`)).body).toEqual({ access: 'owner', trashed: true, deleted: false })
    expect((await call(ALICE, `/api/docs/${alicesOpen}/status`)).body?.access).toBe('owner')

    // alice's own empty, which also lists an ID that's open (not in the Trash).
    const own = await call(ALICE, '/api/trash', { method: 'DELETE', body: { ids: [alices, alicesOpen] } })
    expect(own.body).toEqual({ purged: 1 })
    expect((await call(ALICE, `/api/docs/${alicesOpen}/status`)).body?.access).toBe('owner')
  })
})
