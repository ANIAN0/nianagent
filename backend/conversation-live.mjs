// Ephemeral projection/replay cache. Pi JSONL remains the sole message history.
export class ConversationLive {
  constructor(conversations) {
    this.conversations = conversations
  }
  remember(state, snapshot) {
    state.liveSnapshots ||= new Map()
    state.liveSnapshots.set(snapshot.version, structuredClone(snapshot))
    while (state.liveSnapshots.size > 32)
      state.liveSnapshots.delete(state.liveSnapshots.keys().next().value)
    return snapshot
  }
  wake(state) {
    if (state.liveTimer) return
    state.liveTimer = setTimeout(() => {
      state.liveTimer = undefined
      for (const wake of state.liveWaiters || []) wake()
    }, 30)
  }
  wait(state, signal) {
    return new Promise((resolve, reject) => {
      const done = () => {
        cleanup()
        resolve()
      }
      const abort = () => {
        cleanup()
        reject(signal.reason || new DOMException("已取消", "AbortError"))
      }
      const timer = setTimeout(done, 25000)
      const cleanup = () => {
        clearTimeout(timer)
        state.liveWaiters.delete(done)
        signal?.removeEventListener("abort", abort)
      }
      state.liveWaiters ||= new Set()
      state.liveWaiters.add(done)
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  async follow(sessionId, epoch, afterVersion, signal) {
    const owner = this.conversations
    let state = owner.active.get(sessionId)
    if (!state) {
      await owner.read(sessionId, undefined, signal)
      state = owner.active.get(sessionId)
    }
    owner.ensureOpen()
    signal?.throwIfAborted()
    if (epoch === owner.epoch && afterVersion === state.version)
      await this.wait(state, signal)
    owner.ensureOpen()
    signal?.throwIfAborted()
    if (epoch === owner.epoch && afterVersion === state.version)
      return { kind: "heartbeat", epoch, version: state.version }
    await owner.prepareMedia(state, signal)
    const base =
      epoch === owner.epoch ? state.liveSnapshots?.get(afterVersion) : undefined
    const snapshot = owner.snapshot(state)
    if (!base)
      return {
        kind: "snapshot",
        epoch: owner.epoch,
        version: snapshot.version,
        snapshot,
      }
    const previous = new Map(
      base.messages.map((message) => [message.id, JSON.stringify(message)])
    )
    const { messages, ...metadata } = snapshot
    return {
      kind: "update",
      epoch: owner.epoch,
      version: snapshot.version,
      baseVersion: afterVersion,
      metadata,
      order: messages.map((message) => message.id),
      upserts: messages.filter(
        (message) => previous.get(message.id) !== JSON.stringify(message)
      ),
    }
  }
  close(state) {
    clearTimeout(state.liveTimer)
    for (const wake of state.liveWaiters || []) wake()
  }
}
