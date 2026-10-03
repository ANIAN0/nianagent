import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type { MaterialReference } from "@/features/models/model-contract.generated"
import type { Material } from "@/features/home/home-types"

/** Thumbnail is a UI cache, never an upload or a caller-controlled path. */
export function materialReference(value: Material): MaterialReference {
  return {
    id: value.id, name: value.name, kind: value.kind,
    type: value.type ?? (value.kind === "Skill" ? "skill" : "file"),
    status: value.status ?? "ready", source: value.source ?? "",
    ...(value.description ? { description: value.description } : {}),
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
    ...(value.bytes !== undefined ? { bytes: value.bytes } : {}),
    ...(value.error ? { error: value.error } : {}),
  }
}
export function createMaterialService() {
  return {
    choose: (sessionId: string, cwd: string, signal?: AbortSignal) => modelCall("materialChoose", { sessionId, cwd }, signal),
    prepare: (sessionId: string, cwd: string, paths: string[], signal?: AbortSignal) => modelCall("materialPrepare", { sessionId, cwd, paths }, signal),
    upload: (sessionId: string, cwd: string, file: { name: string; mimeType: string; data: string }, signal?: AbortSignal) => modelCall("materialUpload", { sessionId, cwd, ...file }, signal),
    catalog: (sessionId: string, cwd: string, query: string, signal?: AbortSignal) => modelCall("materialCatalog", { sessionId, cwd, query }, signal),
    preview: (cwd: string, id: string, signal?: AbortSignal) => modelCall("materialPreview", { cwd, id }, signal),
    restore: (sessionId: string, cwd: string, materials: Material[], signal?: AbortSignal) => modelCall("materialRestore", { sessionId, cwd, materials: materials.map(materialReference) }, signal),
  }
}
export type MaterialService = ReturnType<typeof createMaterialService>
/** Catalog examples provide an explicit substitute; null makes them inert. */
export const MaterialServiceContext = createContext<MaterialService | null>(null)

export function materialsReady(materials: Material[]) {
  return materials.every((item) => item.status === undefined || item.status === "ready")
}
export function sameMaterial(left: Material, right: Material) {
  return left.id === right.id || left.type !== "image" && !!left.source && left.source === right.source && left.type === right.type
}
