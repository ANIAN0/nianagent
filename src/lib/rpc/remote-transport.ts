import type {
  ModelOperation,
  RpcRequests,
  RpcResults,
} from "@/contracts/rpc.generated"

export type RemoteCall = <K extends ModelOperation>(
  operation: K,
  input: RpcRequests[K],
  signal?: AbortSignal
) => Promise<RpcResults[K]>
let transport: RemoteCall | null = null
let connectionRevision = 0
const readyListeners = new Set<() => void>()
export const remoteConnectionRevision = () => connectionRevision
export function subscribeRemoteReady(listener: () => void) {
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}
export const isRemoteWeb = () => import.meta.env.BASE_URL === "/moon/"
export function setRemoteTransport(value: RemoteCall | null) {
  transport = value
  if (value) {
    connectionRevision++
    readyListeners.forEach((listener) => listener())
  }
}
export function clearRemoteTransport(owner: RemoteCall) {
  if (transport === owner) transport = null
}
export function remoteCall<K extends ModelOperation>(
  operation: K,
  input: RpcRequests[K],
  signal?: AbortSignal
) {
  if (!transport) return Promise.reject(new Error("远程连接尚未就绪。"))
  return transport(operation, input, signal)
}
