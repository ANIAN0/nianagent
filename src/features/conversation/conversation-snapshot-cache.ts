import type { ConversationSnapshot } from "@/contracts/rpc.generated"

/** 只淘汰可重读的空闲快照；草稿、原请求和正在运行的 owner 不属于缓存。 */
export class ConversationSnapshotCache {
  private readonly frames = new Map<string, ConversationSnapshot>()
  private readonly sizes = new Map<string, number>()
  private bytes = 0

  accept(snapshot: ConversationSnapshot, protectedIds: ReadonlySet<string>) {
    this.bytes -= this.sizes.get(snapshot.id) ?? 0
    this.frames.delete(snapshot.id)
    this.frames.set(snapshot.id, snapshot)
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
    this.sizes.set(snapshot.id, bytes)
    this.bytes += bytes
    for (const [id, value] of this.frames) {
      if (this.frames.size <= 32 && this.bytes <= 64 * 1024 * 1024) break
      if (
        protectedIds.has(id) ||
        id === snapshot.id ||
        ["running", "stopping"].includes(value.phase) ||
        value.command?.status === "started"
      )
        continue
      this.frames.delete(id)
      this.bytes -= this.sizes.get(id) ?? 0
      this.sizes.delete(id)
    }
    return Object.fromEntries(this.frames)
  }
}
