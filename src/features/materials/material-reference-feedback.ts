import type { Material } from "@/features/home/home-types"

type ReferenceState = Pick<
  Material,
  "name" | "type" | "presentation" | "status" | "error" | "retryable"
>

export function isFileReference(item: Pick<Material, "type" | "presentation">) {
  return (
    (item.type === "file" || item.type === "directory") &&
    item.presentation !== "attachment"
  )
}

/** Path checks belong to inline references; attachment preparation keeps its own language. */
export function fileReferenceFeedback(item: ReferenceState) {
  if (!isFileReference(item)) return undefined
  const kind = item.type === "directory" ? "目录" : "文件"
  const preparing = item.status === "preparing"
  const unavailable = `引用${kind}不可用`
  const recovery =
    item.retryable === false ? "重新选择或移除引用" : "重新检查或移除引用"
  return {
    description: preparing ? `正在检查${kind}` : unavailable,
    message: preparing
      ? `正在检查${kind}路径与可读性，完成后可发送。`
      : item.error
        ? `${unavailable}：${item.error} 请${recovery}。`
        : `${unavailable}，请${recovery}。`,
    hint: preparing
      ? `正在检查${kind}，完成后可发送`
      : item.error
        ? `${unavailable}：${item.error} 请${recovery}。`
        : `${unavailable}，请${recovery}。`,
    block: preparing
      ? `${kind}“${item.name}”正在检查，完成后可发送。`
      : `${kind}“${item.name}”不可用${item.error ? `：${item.error.replace(/[。.]+$/u, "")}` : ""}。请${recovery}后发送。`,
  }
}
