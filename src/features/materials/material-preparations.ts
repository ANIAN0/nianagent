import type { MaterialService } from "./material-service"

type Registry = {
  counts: Map<string, number>
  listeners: Set<() => void>
  subscribe: (listener: () => void) => () => void
}
const registries = new WeakMap<MaterialService, Registry>()
function createRegistry(): Registry {
  const registry: Registry = {
    counts: new Map(),
    listeners: new Set(),
    subscribe(listener) {
      registry.listeners.add(listener)
      return () => registry.listeners.delete(listener)
    },
  }
  return registry
}
const unavailable = createRegistry()
export function materialPreparations(service?: MaterialService | null) {
  if (!service) return unavailable
  let registry = registries.get(service)
  if (!registry) {
    registry = createRegistry()
    registries.set(service, registry)
  }
  return registry
}

/** Each composer cancels its own work; mirrors only observe active preparation. */
export class MaterialPreparationSet extends Set<string> {
  private readonly entriesById = new Map<
    string,
    { registry: Registry; key: string }
  >()
  private context: { registry: Registry; scope: string }
  constructor(context: { registry: Registry; scope: string }) {
    super()
    this.context = context
  }
  setContext(context: { registry: Registry; scope: string }) {
    this.context = context
  }
  override has(id: string) {
    const { registry, scope } = this.context
    return super.has(id) || registry.counts.has(JSON.stringify([scope, id]))
  }
  hasBorrowed(id: string, current = this.context) {
    const { registry, scope } = current
    const key = JSON.stringify([scope, id])
    const own = this.entriesById.get(id)
    const ownCount = own?.registry === registry && own.key === key ? 1 : 0
    return (registry.counts.get(key) ?? 0) > ownCount
  }
  override add(id: string) {
    if (super.has(id)) return this
    const { registry, scope } = this.context
    const key = JSON.stringify([scope, id])
    this.entriesById.set(id, { registry, key })
    registry.counts.set(key, (registry.counts.get(key) ?? 0) + 1)
    // The original update publishes the placeholder after this synchronous claim.
    // Notify on release, so an ownerless mirror can then resume validation.
    return super.add(id)
  }
  override delete(id: string) {
    const entry = this.entriesById.get(id)
    if (!entry || !super.delete(id)) return false
    this.entriesById.delete(id)
    const count = entry.registry.counts.get(entry.key) ?? 0
    if (count <= 1) entry.registry.counts.delete(entry.key)
    else entry.registry.counts.set(entry.key, count - 1)
    for (const listener of entry.registry.listeners) listener()
    return true
  }
  override clear() {
    for (const id of [...super.values()]) this.delete(id)
  }
}
