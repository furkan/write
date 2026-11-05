import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useState } from 'react'
import { presenceLabel } from '../identity'
import { useStore } from '../store'
import { getTitle, type Session } from './collab'

/** `email` is client-reported (empty if a client sent none); `name` is its Caret label. */
export type Presence = { clientId: number; name: string; email: string; color: string; self: boolean }

/** Everyone currently connected to the shared document (from Yjs awareness). */
export function usePresence(provider: HocuspocusProvider): Presence[] {
  const [people, setPeople] = useState<Presence[]>([])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness) return
    const update = () => {
      const next: Presence[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as { name?: unknown; color?: unknown; email?: unknown } | undefined
        const email = typeof user?.email === 'string' ? user.email : ''
        const name = presenceLabel(user)
        if (name) {
          const color = typeof user?.color === 'string' && /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : '#888888'
          next.push({ clientId, name, email, color, self: clientId === awareness.clientID })
        }
      })
      next.sort((a, b) => Number(b.self) - Number(a.self))
      setPeople(next)
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [provider])

  return people
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** True while the server can't check who we are and the tab waits to retry (see `Session.retrying`). */
export const useRetrying = (session: Session) => useStore(session.retrying)

export function useConnectionStatus(provider: HocuspocusProvider): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(
    () => provider.configuration.websocketProvider.status as ConnectionStatus,
  )

  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setStatus(status as ConnectionStatus)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
    }
  }, [provider])

  return status
}

/**
 * True while some of this tab's changes have not been confirmed by the server for `delay` ms.
 * Briefly true while typing is normal; staying true on a connected socket means the server
 * refused them (a read-only connection answers updates with "not synced").
 */
export function usePendingChanges(provider: HocuspocusProvider, delay = 1500): boolean {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    const update = ({ number }: { number: number }) => {
      window.clearTimeout(timer)
      if (number === 0) setPending(false)
      else timer = window.setTimeout(() => setPending(provider.unsyncedChanges > 0), delay)
    }
    provider.on('unsyncedChanges', update)
    return () => {
      window.clearTimeout(timer)
      provider.off('unsyncedChanges', update)
    }
  }, [provider, delay])

  return pending
}

/** The shared document title, live across collaborators. */
export function useDocTitle(session: Session): string {
  const [title, setTitle] = useState(() => getTitle(session))

  useEffect(() => {
    const update = () => setTitle(getTitle(session))
    session.meta.observe(update)
    return () => session.meta.unobserve(update)
  }, [session])

  return title
}
