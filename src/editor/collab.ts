import { HocuspocusProvider } from '@hocuspocus/provider'
import { generateJSON, getSchema, type Extensions } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { colorFor, localPart } from '../identity'

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
