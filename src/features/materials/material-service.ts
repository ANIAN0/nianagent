import { rpcCall } from "@/lib/rpc/client"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"
import { chooseRemoteFiles } from "@/lib/rpc/remote-ports"
import type { Material } from "@/lib/composer/types"
export {
  appendPreparedMaterials,
  materialReference,
  MaterialServiceContext,
  materialsReady,
  sameMaterial,
  type MaterialService,
} from "@/lib/composer/material-service-port"

export function createMaterialService() {
  return {
    choose: (sessionId: string, cwd: string, signal?: AbortSignal) =>
      isRemoteWeb()
        ? chooseRemoteFiles(sessionId, cwd, signal)
        : rpcCall("materialChoose", { sessionId, cwd }, signal),
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
