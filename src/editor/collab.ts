import { HocuspocusProvider } from '@hocuspocus/provider'
import { generateJSON, getSchema, type Extensions } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { colorFor, localPart } from '../identity'
import { createStore, type Store } from '../store'

/**
 * What collaborators see of you: the Caret label (your email's local part), a colour derived
 * from the email, and the email itself for the caret's tooltip. Presence is client-reported;
 * the share list is the authoritative "who has access".
 */
export type CollabUser = { name: string; color: string; email: string }

export const collabUser = (email: string): CollabUser => ({ name: localPart(email), color: colorFor(email), email })

/**
 * One open shared document: its Y.Doc, the WebSocket provider and a `meta` map
 * (title) that syncs alongside the editor content.
 */
export type Session = {
  name: string
  ydoc: Y.Doc
  provider: HocuspocusProvider
  meta: Y.Map<unknown>
  fragment: Y.XmlFragment
  /** True while the server can't check who we are (Access's signing keys are unavailable) and we wait to retry. */
  retrying: Store<boolean>
}

/** The server's close code for "can't check who you are right now" (RFC 6455's "Try Again Later"). */
const TRY_AGAIN_LATER = 1013
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30_000

const collabUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

let current: Session | null = null

/**
 * Returns the session for `name`, creating it on first use. Memoised so React
 * StrictMode's double-invoked initialisers don't open two connections.
 *
 * `checkUser` runs each time the socket (re)opens, before anything syncs. If it rejects (the
 * browser is now signed in as someone else), the provider gets no token, so the server never
 * authenticates the document and nothing this tab sends is applied, and the socket is closed
 * until `resume`.
 */
export function getSession(name: string, checkUser: () => Promise<void>): Session {
  if (current?.name === name) return current
  current?.provider.destroy()
  const ydoc = new Y.Doc()
  const provider: HocuspocusProvider = new HocuspocusProvider({
    url: collabUrl,
    name,
    document: ydoc,
    // The server takes the identity from the request headers; the token is only our hook.
    token: async () => {
      try {
        await checkUser()
      } catch (error) {
        queueMicrotask(() => provider.configuration.websocketProvider.disconnect())
        throw error
      }
      return ''
    },
  })
  current = {
    name,
    ydoc,
    provider,
    meta: ydoc.getMap('meta'),
    fragment: ydoc.getXmlFragment('default'),
    retrying: retryWithBackoff(provider),
  }
  provider.on('authenticated', () => reannouncePresence(provider))
  return current
}

/**
 * After every (re)connect, sends our presence again with a newer clock, and accepts everyone
 * else's afresh. When a socket closes, the server drops that tab's presence and tells everyone,
 * and each tab drops the others'; the presence a tab re-sends on reconnect has the clock its
 * peers already saw, so they ignore it. Without this, after an access change (which resets
 * every socket) people stayed invisible to each other until they moved their caret.
 */
function reannouncePresence(provider: HocuspocusProvider) {
  const { awareness } = provider
  if (!awareness) return
  for (const clientId of [...awareness.meta.keys()]) {
    if (clientId !== awareness.clientID && !awareness.states.has(clientId)) awareness.meta.delete(clientId)
  }
  const state = awareness.getLocalState()
  if (state) awareness.setLocalState({ ...state })
}

/**
 * When the server can't check who we are right now, it closes the socket with "Try Again Later".
 * The provider would reconnect every second, each time making the server fetch Access's signing
 * keys again; wait 2 s, then 4 s, and so on up to 30 s instead, until a connection authenticates.
 */
function retryWithBackoff(provider: HocuspocusProvider): Store<boolean> {
  const retrying = createStore(false)
  const socket = provider.configuration.websocketProvider
  let delay = 0
  let timer: number | undefined
  // Runs after the provider's own close handler, so this replaces the reconnect it scheduled.
  socket.on('close', ({ event }: { event?: { code?: number } }) => {
    if (event?.code !== TRY_AGAIN_LATER) return
    delay = Math.min(delay ? delay * 2 : RETRY_MIN_MS, RETRY_MAX_MS)
    socket.disconnect()
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void socket.connect(), delay)
    retrying.set(true)
  })
  // Reconnected some other way (e.g. `resume`): no retry pending any more.
  socket.on('open', () => window.clearTimeout(timer))
  provider.on('authenticated', () => {
    delay = 0
    retrying.set(false)
  })
  provider.on('destroy', () => window.clearTimeout(timer))
  return retrying
}

/**
 * Reconnects now rather than at the next retry, e.g. after signing in again. A socket that is
 * open but was refused for this document would never retry it, so it is replaced.
 */
export function resume(session: Session) {
  const { provider } = session
  const socket = provider.configuration.websocketProvider
  if (socket.status === 'connected' && !provider.isAuthenticated) socket.webSocket?.close()
  else void socket.connect()
}

/** True when the shared document has no editor content yet. */
export const isDocEmpty = (session: Session) => session.fragment.length === 0

/**
 * Writes starter content straight into the Yjs document, before an editor is bound
 * to it. Seeding through the editor instead (setContent after mount) races
 * y-tiptap's first render and can leave the editor and Yjs out of step.
 */
export function seedDoc(session: Session, html: string, extensions: Extensions) {
  if (!isDocEmpty(session)) return
  const schema = getSchema(extensions)
  prosemirrorJSONToYXmlFragment(schema, generateJSON(html, extensions), session.fragment)
}

export const getTitle = (session: Session) => {
  const title = session.meta.get('title')
  return typeof title === 'string' ? title : ''
}

export const setTitle = (session: Session, title: string) => session.meta.set('title', title.slice(0, 200))
