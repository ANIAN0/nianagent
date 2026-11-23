import { useCallback, useSyncExternalStore } from "react"

/** One owner publishes values; views only subscribe to their own session. */
export class SessionValueStore<T> {
  private readonly listeners = new Map<string, Set<() => void>>()

  private values: Record<string, T>

  constructor(values: Record<string, T> = {}) {
    this.values = values
  }

  read = (id: string): T | undefined => this.values[id]

  entries = () => Object.entries(this.values)

  write(id: string, value: T) {
    if (Object.is(this.values[id], value)) return
    this.values[id] = value
    this.notify(id)
  }

  replace(values: Record<string, T>) {
    const previous = this.values
    this.values = values
    for (const id of this.listeners.keys())
      if (!Object.is(previous[id], values[id])) this.notify(id)
  }

  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set()
    listeners.add(listener)
    this.listeners.set(id, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(id)
    }
  }

  private notify(id: string) {
    for (const listener of this.listeners.get(id) ?? []) listener()
  }
}

export function useSessionValue<T>(store: SessionValueStore<T>, id: string) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(id, listener),
    [store, id]
  )
  const read = useCallback(() => store.read(id), [store, id])
  return useSyncExternalStore(subscribe, read)
}
