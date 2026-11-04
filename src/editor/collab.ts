import { HocuspocusProvider } from '@hocuspocus/provider'
import { generateJSON, getSchema, type Extensions } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { readStorage, writeStorage } from './storage'

export type CollabUser = { name: string; color: string }

const COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']
const ANIMALS = ['Otter', 'Falcon', 'Lynx', 'Heron', 'Badger', 'Gecko', 'Marten', 'Puffin', 'Ibex', 'Koala']

const USER_KEY = 'write:user'

function randomUser(): CollabUser {
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  return { name: `Anonymous ${pick(ANIMALS)}`, color: pick(COLORS) }
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

/** `?doc=name` picks the shared document; everyone on the same name edits together. */
export const documentName = new URLSearchParams(location.search).get('doc')?.trim() || 'playground'

const collabUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`

// One Y.Doc + provider per page load. Created at module level so React StrictMode's
// double-mounting doesn't open two connections.
export const ydoc = new Y.Doc()
export const provider = new HocuspocusProvider({
  url: collabUrl,
  name: documentName,
  document: ydoc,
})

const fragment = ydoc.getXmlFragment('default')

/** True when the shared document has never had content written to it. */
export const isSharedDocEmpty = () => fragment.length === 0

/**
 * Writes starter content straight into the Yjs document, before an editor is bound
 * to it. Seeding through the editor instead (setContent after mount) races
 * y-tiptap's first render and can leave the editor and Yjs out of step.
 */
export function seedSharedDoc(html: string, extensions: Extensions) {
  if (!isSharedDocEmpty()) return
  const schema = getSchema(extensions)
  prosemirrorJSONToYXmlFragment(schema, generateJSON(html, extensions), fragment)
}
