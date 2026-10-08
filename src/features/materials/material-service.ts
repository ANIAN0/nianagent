import { createContext } from "react"
import { rpcCall } from "@/lib/rpc/client"
import type { MaterialReference } from "@/contracts/rpc.generated"
import type { Material } from "@/lib/composer/types"

/** Thumbnail is a UI cache, never an upload or a caller-controlled path. */
export function materialReference(value: Material): MaterialReference {
  if (
    !value.type ||
    value.status !== "ready" ||
    !value.source ||
    !/^[a-f0-9]{64}$/.test(value.id)
  )
    throw new Error(`材料“${value.name}”未完成准备，请重新选择或移除。`)
  return {
    id: value.id,
    name: value.name,
    kind: value.kind,
    type: value.type,
    status: value.status,
    source: value.source,
    ...(value.description ? { description: value.description } : {}),
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
    ...(value.bytes !== undefined ? { bytes: value.bytes } : {}),
    ...(value.error ? { error: value.error } : {}),
    ...(typeof value.retryable === "boolean"
      ? { retryable: value.retryable }
      : {}),
  }
}
export function createMaterialService() {
  return {
    choose: (sessionId: string, cwd: string, signal?: AbortSignal) =>
      rpcCall("materialChoose", { sessionId, cwd }, signal),
    prepare: (
      sessionId: string,
      cwd: string,
      paths: string[],
      signal?: AbortSignal,
      options?: { scope?: "selected" | "workspace" }
    ) =>
      rpcCall("materialPrepare", { sessionId, cwd, paths, ...options }, signal),
    upload: (
      sessionId: string,
      cwd: string,
      file: { name: string; mimeType: string; data: string },
      signal?: AbortSignal
    ) => rpcCall("materialUpload", { sessionId, cwd, ...file }, signal),
    catalog: (
      sessionId: string,
      cwd: string,
      query: string,
      signal?: AbortSignal
    ) => rpcCall("materialCatalog", { sessionId, cwd, query }, signal),
    preview: (cwd: string, id: string, signal?: AbortSignal) =>
      rpcCall("materialPreview", { cwd, id }, signal),
    restore: (
      sessionId: string,
      cwd: string,
      materials: Material[],
      signal?: AbortSignal
    ) =>
      rpcCall(
        "materialRestore",
        {
          sessionId,
          cwd,
          materials: materials.map((item) => ({
            id: item.id,
            name: item.name,
            kind: item.kind,
            type: item.type ?? "file",
            status: item.status ?? "failed",
            source: item.source ?? "",
            ...(item.description ? { description: item.description } : {}),
            ...(item.error ? { error: item.error } : {}),
            ...(typeof item.retryable === "boolean"
              ? { retryable: item.retryable }
              : {}),
          })),
        },
        signal
      ),
  }
}
export type MaterialService = ReturnType<typeof createMaterialService>
/** Catalog examples provide an explicit substitute; null makes them inert. */
export const MaterialServiceContext = createContext<MaterialService | null>(
  null
)

export function materialsReady(materials: Material[]) {
  return materials.every((item) => item.status === "ready")
}
export function sameMaterial(left: Material, right: Material) {
  return (
    left.id === right.id ||
    (left.type !== "image" &&
      !!left.source &&
      left.source === right.source &&
      left.type === right.type)
  )
}

/** A deliberate re-selection can repair a failed fixed record in its place. */
export function appendPreparedMaterials(
  current: Material[],
  items: Material[]
) {
  const output = [...current]
  for (const item of items) {
    const index = output.findIndex((value) => sameMaterial(value, item))
    if (index < 0) output.push(item)
    else if (output[index].status === "failed" && item.status === "ready")
      output[index] = output[index].presentation
        ? { ...item, presentation: output[index].presentation }
        : item
  }
  return output
}
