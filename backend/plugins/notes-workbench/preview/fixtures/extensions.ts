import type {
  ExtensionDescriptor,
  ExtensionService,
} from "@/features/extensions/extension-service"
import type { WriteReceipt } from "@/contracts/rpc.generated"

export type ExtensionFixtureMode =
  "ready" | "empty" | "restart" | "unknown" | "pending"
export function createExtensionFixtureService(
  mode: ExtensionFixtureMode = "ready"
): ExtensionService {
  let descriptor: ExtensionDescriptor = {
    id: "example",
    name: "示例扩展",
    description: "演示扩展的全局配置与原操作恢复，未连接真实服务。",
    apiVersion: 1,
    version: "1.0.0",
    revision: 0,
    enabled: false,
    configuration: JSON.stringify({ prefix: "moon" }),
    configurationSchema: JSON.stringify({
      type: "object",
      properties: {
        prefix: {
          type: "string",
          title: "文字前缀",
          description: "回显工具使用的文字前缀",
          default: "moon",
          maxLength: 40,
        },
      },
      additionalProperties: false,
    }),
    tools: [],
    resultKinds: [
      {
        kind: "example.echo",
        version: 1,
        schema: JSON.stringify({ type: "object" }),
      },
    ],
    state: "ready",
    activeSessions: 0,
  }
  const receipts = new Map<string, WriteReceipt>()
  const wait = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted()
      const finish = () => {
        signal?.removeEventListener("abort", abort)
        resolve()
      }
      const timer = setTimeout(finish, 350)
      const abort = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        reject(new DOMException("已取消", "AbortError"))
      }
      signal?.addEventListener("abort", abort, { once: true })
    })
  return {
    evidence: "demo",
    async list(signal) {
      await wait(signal)
      if (mode === "restart")
        throw Object.assign(new Error("宿主需重启"), {
          issue: {
            code: "host_version",
            summary: "示例：当前宿主版本不支持扩展，请更新并重启 Moon。",
            recovery: "restart",
            severity: "error",
          },
        })
      return mode === "empty" ? [] : [structuredClone(descriptor)]
    },
    async configure(value, signal, operationRequestId) {
      await wait(signal)
      if (value.revision !== descriptor.revision)
        throw Object.assign(new Error("版本已变化"), {
          issue: {
            code: "revision_conflict",
            summary: "扩展配置已更新，请返回目录查看最新版本。",
            recovery: "reload",
            severity: "error",
          },
        })
      if (mode !== "pending")
        descriptor = {
          ...descriptor,
          enabled: value.enabled,
          configuration: value.configuration,
          revision: descriptor.revision + 1,
        }
      if (operationRequestId)
        receipts.set(operationRequestId, {
          operation: "extensionConfigure",
          operationRequestId,
          targetId: descriptor.id,
          state: mode === "pending" ? "unknown" : "committed",
          revision: descriptor.revision,
        })
      if (mode === "unknown" || mode === "pending")
        throw Object.assign(new Error("保存结果未知"), {
          issue: {
            code: "result_unknown",
            summary: "示例：未收到保存结果，草稿已保留，请核对原请求。",
            recovery: "check",
            severity: "warning",
          },
        })
      return structuredClone(descriptor)
    },
    async readWriteReceipt(operation, operationRequestId, signal) {
      await wait(signal)
      return structuredClone(
        receipts.get(operationRequestId) ?? {
          operation,
          operationRequestId,
          targetId: "",
          state: "unknown",
        }
      )
    },
  }
}
