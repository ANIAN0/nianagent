import { isRemoteWeb } from "./remote-transport"

let remotePrefix: string | undefined

/** Bind once per page, before mounting any business owner or restoring requests. */
export function bindRemoteStorage(identity: {
  gateway: string
  server: string
  key: string
  profileId: string
}) {
  if (typeof identity.profileId !== "string" || !identity.profileId)
    throw new Error("远程主机未提供数据集身份，请更新主机后重新连接。")
  const prefix = `moon.remote.profile.v1.${encodeURIComponent(
    JSON.stringify([
      identity.gateway,
      identity.server,
      identity.key,
      identity.profileId,
    ])
  )}.`
  // A new host/profile needs a fresh page: module caches and in-flight work
  // must remain attached to the old owner until they are disposed.
  if (remotePrefix !== undefined && remotePrefix !== prefix) return false
  remotePrefix = prefix
  return true
}

function prefix() {
  if (!isRemoteWeb()) return ""
  if (remotePrefix === undefined)
    throw new Error("远程数据集尚未确认，不能恢复或保存工作状态。")
  return remotePrefix
}

type ProfileStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>
function scopedStorage(
  kind: "localStorage" | "sessionStorage"
): ProfileStorage {
  const keys = () => {
    const scope = prefix()
    const storage = window[kind]
    const result: string[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(scope)) result.push(key.slice(scope.length))
    }
    return result
  }
  return {
    get length() {
      return keys().length
    },
    key: (index) => keys()[index] ?? null,
    getItem: (key) => window[kind].getItem(prefix() + key),
    setItem: (key, value) => window[kind].setItem(prefix() + key, value),
    removeItem: (key) => window[kind].removeItem(prefix() + key),
  }
}

export const profileLocalStorage = scopedStorage("localStorage")
export const profileSessionStorage = scopedStorage("sessionStorage")
