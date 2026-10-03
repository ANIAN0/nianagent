import type { CatalogMetadata } from "./catalog-types"
import { catalogImportPath } from "./catalog-path"

const sources = import.meta.glob<string>(
  [
    "../src/**/*.tsx",
    "../api-catalog/**/*.tsx",
    "./**/*.tsx",
    "!../src/**/*.catalog.tsx",
    "!../api-catalog/**/*.catalog.tsx",
    "!./**/*.catalog.tsx",
  ],
  { query: "?raw", import: "default" }
)

/** Cancellation drops stale results; ES module loading itself is managed by the browser. */
export function loadSource(
  entry: CatalogMetadata,
  signal?: AbortSignal
): Promise<string> {
  const load = sources[catalogImportPath(entry.source)]
  if (!load) return Promise.reject(new Error(`找不到正式源码：${entry.source}`))
  if (signal?.aborted)
    return Promise.reject(new DOMException("源码读取已取消", "AbortError"))
  return new Promise((resolve, reject) => {
    const cancel = () =>
      reject(new DOMException("源码读取已取消", "AbortError"))
    signal?.addEventListener("abort", cancel, { once: true })
    load()
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener("abort", cancel))
  })
}
