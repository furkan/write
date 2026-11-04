import { HocuspocusProvider } from '@hocuspocus/provider'
import { generateJSON, getSchema, type Extensions } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { readStorage, writeStorage } from './storage'

export type CollabUser = { name: string; color: string }

export const USER_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']
const ANIMALS = ['Otter', 'Falcon', 'Lynx', 'Heron', 'Badger', 'Gecko', 'Marten', 'Puffin', 'Ibex', 'Koala']

const USER_KEY = 'write:user'

function randomUser(): CollabUser {
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  return { name: `Anonymous ${pick(ANIMALS)}`, color: pick(USER_COLORS) }
}

export function loadUser(): CollabUser {
  try {
    const saved = JSON.parse(readStorage(USER_KEY) ?? 'null') as Partial<CollabUser> | null
    if (saved?.name && saved.color) return { name: saved.name, color: saved.color }
  } catch {
    // fall through to a fresh identity
  }
  const user = randomUser()
  writeStorage(USER_KEY, JSON.stringify(user))
  return user
}

export function saveUser(user: CollabUser) {
  writeStorage(USER_KEY, JSON.stringify(user))
}

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
}

const collabUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

let current: Session | null = null

/**
 * Returns the session for `name`, creating it on first use. Memoised so React
 * StrictMode's double-invoked initialisers don't open two connections.
 */
export function getSession(name: string): Session {
  if (current?.name === name) return current
  current?.provider.destroy()
  const ydoc = new Y.Doc()
  current = {
    name,
    ydoc,
    provider: new HocuspocusProvider({ url: collabUrl, name, document: ydoc }),
    meta: ydoc.getMap('meta'),
    fragment: ydoc.getXmlFragment('default'),
  }
  return current
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
