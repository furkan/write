import { useSyncExternalStore } from 'react'

/** A value that lives outside React (module state, a session) and that components can follow. */
export type Store<T> = {
  get: () => T
  /** Notifies subscribers when the value changes. */
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(value, next)) return
      value = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

export const useStore = <T,>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get)
