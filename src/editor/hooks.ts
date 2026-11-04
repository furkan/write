import { useEffect, useState } from 'react'
import { provider } from './collab'

export type Presence = { clientId: number; name: string; color: string; self: boolean }

/** Everyone currently connected to the shared document (from Yjs awareness). */
export function usePresence(): Presence[] {
  const [people, setPeople] = useState<Presence[]>([])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness) return
    const update = () => {
      const next: Presence[] = []
      awareness.getStates().forEach((state, clientId) => {
        const user = state.user as { name?: string; color?: string } | undefined
        if (user?.name) {
          next.push({ clientId, name: user.name, color: user.color ?? '#888', self: clientId === awareness.clientID })
        }
      })
      next.sort((a, b) => Number(b.self) - Number(a.self))
      setPeople(next)
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [])

  return people
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(
    () => provider.configuration.websocketProvider.status as ConnectionStatus,
  )

  useEffect(() => {
    const onStatus = ({ status }: { status: string }) => setStatus(status as ConnectionStatus)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
    }
  }, [])

  return status
}
