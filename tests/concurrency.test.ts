/**
 * Access changes that land while a request or connection is in flight (server review #1–#4, #7),
 * in Dev mode (`vite` on 5180/1240). `slowRequest` sends a request's headers now and its body
 * later, the way a slow or stalled client would.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { docFileName } from '../server/collab.ts'
import {
  api,
  connectDocument,
  DEV_PORTS,
  readText,
  slowRequest,
  startServer,
  typeParagraph,
  type LiveDocument,
  type RunningServer,
} from './helpers.ts'

const ALICE = 'alice@x.com'
const BOB = 'bob@x.com'
const CAROL = 'carol@x.com'

const as = (server: RunningServer, email: string) => ({
  cookie: `write-dev-user=${encodeURIComponent(email)}`,
  origin: server.url,
  'content-type': 'application/json',
})

describe('requests in flight while access changes', () => {
  let server: RunningServer
  let ws: string
  beforeAll(async () => {
    server = await startServer({ command: 'dev', ...DEV_PORTS })
    ws = `ws://127.0.0.1:${server.port}/collab`
  }, 30_000)
  afterAll(() => server?.stop())

  const call = (email: string, path: string, method = 'GET', body?: unknown) =>
    api(server, path, { method, headers: as(server, email), body: body === undefined ? undefined : JSON.stringify(body) })
  const create = async (title: string) => String((await call(ALICE, '/api/docs', 'POST', { title })).body?.id)
  const share = (id: string, email: string, role: string) => call(ALICE, `/api/docs/${id}/shares/${email}`, 'PUT', { role })
  const slow = (email: string, method: string, path: string, body: unknown) =>
    slowRequest(server, method, path, as(server, email), JSON.stringify(body))
  const liveTitle = async (id: string) => {
    const live = await connectDocument(ws, id, as(server, ALICE))
    live.destroy()
    return live.doc.getMap('meta').get('title')
  }
  const index = async () =>
    JSON.parse(await readFile(join(server.dataDir, 'index.json'), 'utf8')) as {
      docs: Record<string, { title: string; shares: Record<string, string>; trashedAt?: number }>
      deleted: Record<string, string>
    }

  test('#1 a rename sent before the editor was unshared is refused', async () => {
    const id = await create('original')
    await share(id, BOB, 'editor')
    const rename = slow(BOB, 'PATCH', `/api/docs/${id}`, { title: 'renamed by revoked bob' })
    await Bun.sleep(150)
    expect((await call(ALICE, `/api/docs/${id}/shares/${BOB}`, 'DELETE')).status).toBe(204)
    expect((await rename.finish()).status).toBe(404)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.title).toBe('original')
    expect(await liveTitle(id)).toBe('original')
  })

  test('#1 a rename sent before the owner trashed the document changes nothing', async () => {
    const id = await create('before trash')
    await share(id, BOB, 'editor')
    const rename = slow(BOB, 'PATCH', `/api/docs/${id}`, { title: 'written while trashed' })
    await Bun.sleep(150)
    expect((await call(ALICE, `/api/docs/${id}`, 'DELETE')).status).toBe(204)
    expect((await rename.finish()).status).toBe(404)
    await call(ALICE, `/api/trash/${id}/restore`, 'POST')
    expect(await liveTitle(id)).toBe('before trash')
    expect((await index()).docs[id].title).toBe('before trash')
  })

  test('#1 a rename sent before a demotion to viewer is forbidden', async () => {
    const id = await create('kept')
    await share(id, BOB, 'editor')
    const rename = slow(BOB, 'PATCH', `/api/docs/${id}`, { title: 'by demoted bob' })
    await Bun.sleep(150)
    await share(id, BOB, 'viewer')
    expect((await rename.finish()).status).toBe(403)
    expect(await liveTitle(id)).toBe('kept')
  })

  test('#2 two shares in flight at once both stick', async () => {
    const id = await create('two shares')
    const first = slow(ALICE, 'PUT', `/api/docs/${id}/shares/${BOB}`, { role: 'editor' })
    await Bun.sleep(150)
    expect((await share(id, CAROL, 'viewer')).status).toBe(200)
    expect((await first.finish()).status).toBe(200)
    expect((await call(ALICE, `/api/docs/${id}`)).body?.shares).toEqual({ [BOB]: 'editor', [CAROL]: 'viewer' })
    expect((await index()).docs[id].shares).toEqual({ [BOB]: 'editor', [CAROL]: 'viewer' })
  })

  test('#2 a share in flight does not bring a trashed document back', async () => {
    const id = await create('stays trashed')
    await share(id, CAROL, 'viewer')
    const put = slow(ALICE, 'PUT', `/api/docs/${id}/shares/${BOB}`, { role: 'editor' })
    await Bun.sleep(150)
    expect((await call(ALICE, `/api/docs/${id}`, 'DELETE')).status).toBe(204)
    expect((await put.finish()).status).toBe(404)
    expect((await call(ALICE, `/api/docs/${id}/status`)).body).toEqual({ access: 'owner', trashed: true, deleted: false })
    expect((await call(BOB, `/api/docs/${id}/status`)).body?.access).toBe('none')
    expect((await call(CAROL, `/api/docs/${id}/status`)).body).toEqual({ access: 'none', trashed: true, deleted: false })
    expect((await index()).docs[id].shares).toEqual({ [CAROL]: 'viewer' })
  })

  test('#2 a share in flight does not resurrect a document deleted forever', async () => {
    const id = await create('zombie')
    const put = slow(ALICE, 'PUT', `/api/docs/${id}/shares/${BOB}`, { role: 'editor' })
    await Bun.sleep(150)
    await call(ALICE, `/api/docs/${id}`, 'DELETE')
    expect((await call(ALICE, `/api/trash/${id}`, 'DELETE')).status).toBe(204)
    expect((await put.finish()).status).toBe(404)
    const after = await index()
    expect(after.docs).not.toHaveProperty(id)
    expect(after.deleted[id]).toBe(ALICE)
    expect((await call(BOB, '/api/docs')).body?.docs).not.toContainEqual(expect.objectContaining({ id }))
  })

  test('#2 an unshare in flight does not undo a trash', async () => {
    const id = await create('unshare vs trash')
    await share(id, BOB, 'editor')
    const remove = slow(BOB, 'DELETE', `/api/docs/${id}/shares/${BOB}`, {})
    await Bun.sleep(150)
    await call(ALICE, `/api/docs/${id}`, 'DELETE')
    expect((await remove.finish()).status).toBe(404)
    expect((await index()).docs[id]).toMatchObject({ shares: { [BOB]: 'editor' }, trashedAt: expect.any(Number) })
  })

  test('#2 a title stored while a share is in flight is kept', async () => {
    const id = await create('old title')
    const put = slow(ALICE, 'PUT', `/api/docs/${id}/shares/${BOB}`, { role: 'viewer' })
    await Bun.sleep(150)
    expect((await call(ALICE, `/api/docs/${id}`, 'PATCH', { title: 'new title' })).status).toBe(200)
    expect((await put.finish()).status).toBe(200)
    expect((await call(ALICE, `/api/docs/${id}`)).body).toMatchObject({ title: 'new title', shares: { [BOB]: 'viewer' } })
  })

  test('#7 bodies over 64 KB are refused with 413', async () => {
    const big = JSON.stringify({ title: 'x'.repeat(70 * 1024) })
    const response = await api(server, '/api/docs', { method: 'POST', headers: as(server, ALICE), body: big })
    expect(response).toEqual({ status: 413, body: { error: 'request body too large' } })
    // Without a Content-Length too (chunked).
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big))
        controller.close()
      },
    })
    const chunked = await fetch(`${server.url}/api/docs`, { method: 'POST', headers: as(server, ALICE), body: stream })
    expect(chunked.status).toBe(413)
    expect((await call(ALICE, '/api/me')).status).toBe(200)
  })

  test('#7 a server error answers a generic body and logs the details', async () => {
    if (process.getuid?.() === 0) return // root ignores file permissions
    await chmod(server.dataDir, 0o500)
    try {
      const response = await call(ALICE, '/api/docs', 'POST', { title: 'cannot write' })
      expect(response).toEqual({ status: 500, body: { error: 'error' } })
      expect(server.output()).toContain('[write] POST /api/docs failed:')
      expect(server.output()).toContain(server.dataDir)
    } finally {
      await chmod(server.dataDir, 0o700)
    }
  })

  test("#3 a connection can't forge or remove someone else's presence", async () => {
    const id = await create('presence')
    await share(id, BOB, 'editor')
    await share(id, CAROL, 'viewer')
    const live: LiveDocument[] = []
    try {
      const alice = await connectDocument(ws, id, as(server, ALICE))
      live.push(alice)
      alice.provider.setAwarenessField('user', { name: 'alice' })
      const bob = await connectDocument(ws, id, as(server, BOB))
      live.push(bob)
      const carol = await connectDocument(ws, id, as(server, CAROL))
      live.push(carol)
      carol.provider.setAwarenessField('user', { name: 'carol' })
      const aliceId = alice.doc.clientID
      const seenByBob = () => bob.provider.awareness?.getStates().get(aliceId)
      const until = async (check: () => boolean) => {
        for (let i = 0; i < 40 && !check(); i++) await Bun.sleep(50)
      }
      await until(() => seenByBob()?.user?.name === 'alice')
      expect(seenByBob()).toEqual({ user: { name: 'alice' } })

      // carol (a viewer) sends an update under alice's client ID, with a higher clock...
      const forgedDoc = new Y.Doc()
      forgedDoc.clientID = aliceId
      const forged = new Awareness(forgedDoc)
      for (let i = 0; i < 50; i++) forged.setLocalState({ user: { name: 'forged by carol' } })
      const send = (update: Uint8Array) => applyAwarenessUpdate(carol.provider.awareness!, update, 'forge')
      send(encodeAwarenessUpdate(forged, [aliceId]))
      // ... and then tries to remove it.
      forged.setLocalState(null)
      send(encodeAwarenessUpdate(forged, [aliceId]))
      // carol's own presence still goes through, so her messages were delivered.
      carol.provider.setAwarenessField('user', { name: 'carol, later' })
      const carolId = carol.doc.clientID
      await until(() => bob.provider.awareness?.getStates().get(carolId)?.user?.name === 'carol, later')
      expect(bob.provider.awareness?.getStates().get(carolId)).toEqual({ user: { name: 'carol, later' } })
      expect(seenByBob()).toEqual({ user: { name: 'alice' } })
      forged.destroy()
    } finally {
      for (const connection of live) connection.destroy()
    }
  })

  test("#5 while everyone reconnects after an access change, a viewer can't take someone's presence ID", async () => {
    const id = await create('presence after a reset')
    await share(id, BOB, 'editor')
    await share(id, CAROL, 'viewer')
    const live: LiveDocument[] = []
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 40 && !check(); i++) await Bun.sleep(50)
    }
    try {
      const alice = await connectDocument(ws, id, as(server, ALICE))
      live.push(alice)
      alice.provider.setAwarenessField('user', { name: 'alice' })
      const bob = await connectDocument(ws, id, as(server, BOB))
      live.push(bob)
      const aliceId = alice.doc.clientID
      const seenByBob = () => bob.provider.awareness?.getStates().get(aliceId)
      await until(() => seenByBob()?.user?.name === 'alice')
      expect(seenByBob()).toEqual({ user: { name: 'alice' } })

      // An access change reset every socket: alice's tab is between connections, and carol, a
      // viewer, is back first, under alice's client ID, with a high clock.
      alice.destroy()
      await until(() => seenByBob() === undefined)
      const carol = await connectDocument(ws, id, as(server, CAROL), { clientID: aliceId })
      live.push(carol)
      for (let i = 0; i < 5; i++) carol.provider.setAwarenessField('user', { name: `not alice ${i}` })
      await Bun.sleep(300)
      expect(seenByBob()).toBeUndefined()

      // alice's tab reconnects, with the same client ID, and announces itself again.
      const back = await connectDocument(ws, id, as(server, ALICE), { clientID: aliceId })
      live.push(back)
      for (let i = 0; i < 8; i++) back.provider.setAwarenessField('user', { name: 'alice, back' })
      await until(() => seenByBob()?.user?.name === 'alice, back')
      expect(seenByBob()).toEqual({ user: { name: 'alice, back' } })
    } finally {
      for (const connection of live) connection.destroy()
    }
  })
})

describe('messages queued before a connection is set up (#4)', () => {
  const DOC = 'big-shared-doc'
  let server: RunningServer
  beforeAll(async () => {
    server = await startServer({
      command: 'dev',
      ...DEV_PORTS,
      // A large document takes a while to load: the window in which a new connection has passed
      // onAuthenticate but isn't registered on the document yet, so closeConnections misses it.
      seed: async (dataDir) => {
        const doc = new Y.Doc()
        const fragment = doc.getXmlFragment('default')
        const paragraphs = Array.from({ length: 150_000 }, (_, i) => {
          const paragraph = new Y.XmlElement('paragraph')
          paragraph.insert(0, [new Y.XmlText(`line ${i}`)])
          return paragraph
        })
        fragment.insert(0, paragraphs)
        await writeFile(join(dataDir, docFileName(DOC)), Y.encodeStateAsUpdate(doc))
        const now = Date.now()
        await writeFile(
          join(dataDir, 'index.json'),
          JSON.stringify({
            version: 2,
            docs: {
              [DOC]: { title: 'Big', preview: '', words: 0, createdAt: now, updatedAt: now, owner: ALICE, shares: { [BOB]: 'editor' } },
            },
            deleted: {},
          }),
        )
      },
    })
  }, 30_000)
  afterAll(() => server?.stop())

  /**
   * A hand-made client for bob: sends its auth message (and `queued`, right behind it, without
   * waiting), and resolves once onAuthenticate passed; the document is then still loading.
   */
  async function rawClient(queued?: Uint8Array) {
    const auth = encoding.createEncoder()
    encoding.writeVarString(auth, DOC)
    encoding.writeVarUint(auth, 2) // MessageType.Auth
    encoding.writeVarUint(auth, 0) // AuthMessageType.Token
    encoding.writeVarString(auth, '')
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/collab`, {
      headers: { cookie: `write-dev-user=${BOB}`, origin: server.url },
    } as unknown as string[])
    socket.binaryType = 'arraybuffer'
    const authenticated = new Promise<void>((done) => {
      socket.onmessage = (event) => {
        const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer))
        decoding.readVarString(decoder)
        if (decoding.readVarUint(decoder) === 2 && decoding.readVarUint(decoder) === 2) done()
      }
    })
    const closed = new Promise<boolean>((done) => (socket.onclose = () => done(true)))
    await new Promise((done) => (socket.onopen = done))
    socket.send(encoding.toUint8Array(auth))
    if (queued) socket.send(new Uint8Array(queued))
    await authenticated
    return { socket, closed }
  }

  const revokeBob = async () => {
    const response = await api(server, `/api/docs/${DOC}/shares/${BOB}`, { method: 'DELETE', headers: as(server, ALICE) })
    expect(response.status).toBe(204)
  }

  test('an update queued behind the auth message is dropped when access is revoked meanwhile', async () => {
    const edit = new Y.Doc()
    typeParagraph(edit, 'queued edit from revoked bob')
    const update = encoding.createEncoder()
    encoding.writeVarString(update, DOC)
    encoding.writeVarUint(update, 0) // MessageType.Sync
    encoding.writeVarUint(update, 2) // messageYjsUpdate
    encoding.writeVarUint8Array(update, Y.encodeStateAsUpdate(edit))

    const client = await rawClient(encoding.toUint8Array(update))
    await revokeBob()
    expect(await Promise.race([client.closed, Bun.sleep(10_000).then(() => false)])).toBe(true)

    await Bun.sleep(1500)
    const text = await readText(`ws://127.0.0.1:${server.port}/collab`, DOC, as(server, ALICE))
    expect(text).toContain('line 149999')
    expect(text).not.toContain('queued edit from revoked bob')
  }, 30_000)

  test('a silent connection set up after its access was revoked is closed, not left listening', async () => {
    // Share again, and let the document unload so loading it takes a while once more.
    const shared = await api(server, `/api/docs/${DOC}/shares/${BOB}`, {
      method: 'PUT',
      headers: as(server, ALICE),
      body: JSON.stringify({ role: 'editor' }),
    })
    expect(shared.status).toBe(200)
    await Bun.sleep(1500)
    const client = await rawClient()
    await revokeBob()
    expect(await Promise.race([client.closed, Bun.sleep(10_000).then(() => false)])).toBe(true)
    client.socket.close()
  }, 30_000)
})
