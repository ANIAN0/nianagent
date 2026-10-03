import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type { MaterialReference } from "@/features/models/model-contract.generated"
import type { Material } from "@/features/home/home-types"

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
  }
}
export function createMaterialService() {
  return {
    choose: (sessionId: string, cwd: string, signal?: AbortSignal) =>
      modelCall("materialChoose", { sessionId, cwd }, signal),
    prepare: (
      sessionId: string,
      cwd: string,
      paths: string[],
      signal?: AbortSignal
    ) => modelCall("materialPrepare", { sessionId, cwd, paths }, signal),
    upload: (
      sessionId: string,
      cwd: string,
      file: { name: string; mimeType: string; data: string },
      signal?: AbortSignal
    ) => modelCall("materialUpload", { sessionId, cwd, ...file }, signal),
    catalog: (
      sessionId: string,
      cwd: string,
      query: string,
      signal?: AbortSignal
    ) => modelCall("materialCatalog", { sessionId, cwd, query }, signal),
    preview: (cwd: string, id: string, signal?: AbortSignal) =>
      modelCall("materialPreview", { cwd, id }, signal),
    restore: (
      sessionId: string,
      cwd: string,
      materials: Material[],
      signal?: AbortSignal
    ) =>
      modelCall(
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
  return materials.every(
    (item) => item.status === undefined || item.status === "ready"
  )
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
