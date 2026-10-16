import { useSyncExternalStore } from "react"
import {
  remoteConnectionRevision,
  subscribeRemoteReady,
} from "./remote-transport"

/** A new authenticated connection refreshes reads, never submitted actions. */
export function useRemoteConnectionRevision() {
  return useSyncExternalStore(
    subscribeRemoteReady,
    remoteConnectionRevision,
    remoteConnectionRevision
  )
}
