import type { MaterialService } from "./material-service"
import type { Material } from "@/lib/composer/types"

export const uploadRetrySourceLimits = {
  entries: 32,
  bytes: 128 * 1024 * 1024,
  lifetime: 30 * 60 * 1000,
} as const

type Entry = { file: File; expires: number }
type Bucket = {
  entries: Map<string, Entry>
  bytes: number
  timer?: ReturnType<typeof setTimeout>
}

// Temporary memory belongs to the service instance. Nothing is persisted, and
// a catalog substitute cannot access the application's upload candidates.
const buckets = new WeakMap<MaterialService, Bucket>()
const key = (sessionId: string, cwd: string, id: string) =>
  JSON.stringify([sessionId, cwd, id])
const temporary = (id: string) => /^preparing:[a-zA-Z0-9-]+$/.test(id)

function remove(bucket: Bucket, id: string) {
  const entry = bucket.entries.get(id)
  if (!entry) return
  bucket.bytes -= entry.file.size
  bucket.entries.delete(id)
}
function expire(bucket: Bucket) {
  const now = Date.now()
  const previous = bucket.entries.size
  for (const [id, entry] of bucket.entries)
    if (entry.expires <= now) remove(bucket, id)
  return previous !== bucket.entries.size
}
function schedule(bucket: Bucket) {
  clearTimeout(bucket.timer)
  bucket.timer = undefined
  if (!bucket.entries.size) return
  const expires = Math.min(
    ...Array.from(bucket.entries.values(), (entry) => entry.expires)
  )
  // A timer must not extend a replaced service's lifetime through its Files.
  const weak = new WeakRef(bucket)
  const timer = setTimeout(
    () => {
      const current = weak.deref()
      if (!current) return
      current.timer = undefined
      expire(current)
      schedule(current)
    },
    Math.max(1, expires - Date.now())
  )
  bucket.timer = timer
  // Browser timers are numbers; formal Node regressions need no keep-alive.
  ;(timer as unknown as { unref?: () => void }).unref?.()
}

/** Only provisional uploads carry Files; fixed authority images never do. */
export function rememberUploadRetrySource(
  service: MaterialService,
  sessionId: string,
  cwd: string,
  id: string,
  file: File
) {
  if (
    !sessionId ||
    !cwd ||
    !temporary(id) ||
    !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    return
  let bucket = buckets.get(service)
  if (!bucket) {
    bucket = { entries: new Map(), bytes: 0 }
    buckets.set(service, bucket)
  }
  expire(bucket)
  const identity = key(sessionId, cwd, id)
  remove(bucket, identity)
  bucket.entries.set(identity, {
    file,
    expires: Date.now() + uploadRetrySourceLimits.lifetime,
  })
  bucket.bytes += file.size
  while (
    bucket.entries.size > uploadRetrySourceLimits.entries ||
    bucket.bytes > uploadRetrySourceLimits.bytes
  ) {
    const oldest = bucket.entries.keys().next().value
    if (oldest === undefined) break
    remove(bucket, oldest)
  }
  schedule(bucket)
}

export function getUploadRetrySource(
  service: MaterialService,
  sessionId: string,
  cwd: string,
  id: string
) {
  if (!temporary(id)) return undefined
  const bucket = buckets.get(service)
  if (!bucket) return undefined
  const expired = expire(bucket)
  const entry = bucket.entries.get(key(sessionId, cwd, id))
  if (expired) schedule(bucket)
  return entry?.file
}

/** 维护只核对原临时源，不改状态或延长寿命；失败占位材料也可能仍持有仅内存的 File。 */
export function materialsBlockMaintenance(
  service: MaterialService | null | undefined,
  sessionId: string,
  materials: readonly Material[]
) {
  if (materials.some((material) => material.status === "preparing")) return true
  if (!service || !sessionId) return false
  const bucket = buckets.get(service)
  if (!bucket) return false
  const ids = new Set(
    materials
      .filter((material) => temporary(material.id))
      .map((material) => material.id)
  )
  for (const identity of bucket.entries.keys()) {
    const [owner, cwd, id] = JSON.parse(identity) as [string, string, string]
    if (
      owner === sessionId &&
      ids.has(id) &&
      getUploadRetrySource(service, owner, cwd, id)
    )
      return true
  }
  return false
}

/** 隐藏编辑 owner 可卸载，原 File 仍由同一正式服务持有；App flush 不能因此漏掉它。 */
export function hasRetainedUploadSources(service: MaterialService) {
  const bucket = buckets.get(service)
  if (!bucket) return false
  if (expire(bucket)) schedule(bucket)
  return bucket.entries.size > 0
}

export function releaseUploadRetrySource(
  service: MaterialService,
  sessionId: string,
  cwd: string,
  id: string
) {
  const bucket = buckets.get(service)
  if (!bucket) return
  remove(bucket, key(sessionId, cwd, id))
  schedule(bucket)
}
