// @ts-check
/** @typedef {import("../src/contracts/rpc.generated.ts").ConversationSnapshot} Snapshot */
/** @typedef {Snapshot["messages"][number]} Message */
/** @typedef {{projectedMessages?:Map<string,{value:Message,bytes:number}>,liveSnapshots?:Map<number,Snapshot>,liveSnapshotSizes?:Map<number,number>,liveSnapshotBytes?:number}} ProjectionCache */
import { isDeepStrictEqual } from "node:util"
/** 投影属于可重建缓存；共享稳定消息，按估算字节预算回退到整帧同步。 */
/** @param {ProjectionCache} state @param {Snapshot} snapshot @param {number} [maximumBytes] */
export function retainProjection(
  state,
  snapshot,
  maximumBytes = 16 * 1024 * 1024
) {
  const previous = state.projectedMessages ?? new Map()
  const current = new Map()
  let messageBytes = 0
  const messages = snapshot.messages.map((message) => {
    const known = previous.get(message.id)
    const unchanged = known && isDeepStrictEqual(message, known.value)
    const value = unchanged ? known.value : structuredClone(message)
    const bytes = unchanged
      ? known.bytes
      : Buffer.byteLength(JSON.stringify(value))
    messageBytes += bytes
    current.set(message.id, { bytes, value })
    return value
  })
  state.projectedMessages = current
  const { messages: _messages, ...metadata } = snapshot
  const value = { ...structuredClone(metadata), messages }
  const bytes = messageBytes + Buffer.byteLength(JSON.stringify(metadata))
  state.liveSnapshots ??= new Map()
  state.liveSnapshotSizes ??= new Map()
  state.liveSnapshotBytes ??= 0
  state.liveSnapshotBytes -= state.liveSnapshotSizes.get(snapshot.version) ?? 0
  state.liveSnapshots.set(snapshot.version, value)
  state.liveSnapshotSizes.set(snapshot.version, bytes)
  state.liveSnapshotBytes += bytes
  while (
    state.liveSnapshots.size > 1 &&
    (state.liveSnapshots.size > 32 || state.liveSnapshotBytes > maximumBytes)
  ) {
    const oldest = state.liveSnapshots.keys().next().value
    state.liveSnapshots.delete(oldest)
    state.liveSnapshotBytes -= state.liveSnapshotSizes.get(oldest)
    state.liveSnapshotSizes.delete(oldest)
  }
  return value
}
