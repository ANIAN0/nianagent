import type { StorageDirectoryMapping } from "@/contracts/desktop.generated"
import type { ComposerDraft } from "@/lib/composer/types"
import { loadConfigurationDrafts } from "@/lib/operations/configuration-draft-store"

let mappings: StorageDirectoryMapping[] = []
const normalize = (path: string) =>
  path.replaceAll("\\", "/").replace(/\/+$/, "")
function materialSource(source: string) {
  const normalized = normalize(source)
  for (const mapping of mappings) {
    const root = normalize(mapping.sourceRoot)
    const relative = normalized.slice(root.length + 1)
    if (
      normalized
        .toLocaleLowerCase()
        .startsWith(root.toLocaleLowerCase() + "/") &&
      /^(materials|agent)\//i.test(relative) &&
      !relative.split("/").some((item) => item === ".." || item === ".")
    )
      return normalize(mapping.targetRoot) + "/" + relative
  }
  return source
}
/** 只投影可继续编辑的材料来源；未知原请求 payload/副本/签名永不改写。 */
export function projectEditableDraft(draft: ComposerDraft): ComposerDraft {
  if (!mappings.length) return draft
  return {
    ...draft,
    materials: draft.materials.map((item) => ({
      ...item,
      source: materialSource(item.source),
    })),
  }
}
function mapDraft(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as Partial<ComposerDraft>).materials)
  )
    throw new Error("草稿材料恢复结构无效，原记录已保留。")
  const draft = value as ComposerDraft
  if (
    typeof draft.text !== "string" ||
    !draft.materials.every(
      (item) =>
        !!item && typeof item.id === "string" && typeof item.source === "string"
    )
  )
    throw new Error("草稿身份或材料来源无效，原记录已保留。")
  return projectEditableDraft(draft)
}
export function prepareFrontendRecovery(
  directoryMappings: StorageDirectoryMapping[]
) {
  mappings = directoryMappings
  loadConfigurationDrafts()
  const writes: [string, string][] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (!key) continue
    const plainDraft =
      key.startsWith("moon.chat.draft.v1.") ||
      key.startsWith("moon.home.draft.v1.")
    const queueDraft = key.startsWith("moon.queue.edit.v1.")
    const homeTransfer = key.startsWith("moon.home.submission.v1.")
    if (!plainDraft && !queueDraft && !homeTransfer) continue
    const text = localStorage.getItem(key)
    if (text === null) continue
    if (text.length > 8 * 1024 * 1024)
      throw new Error("草稿恢复记录过大，原记录已保留。")
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error("草稿恢复记录无法解析，原记录已保留。")
    }
    if (plainDraft) value = mapDraft(value)
    else {
      if (!value || typeof value !== "object")
        throw new Error("原提交恢复记录无效，原记录已保留。")
      if (queueDraft)
        value = {
          ...value,
          draft: mapDraft((value as { draft?: unknown }).draft),
        }
      else {
        const transfer = (value as { transfer?: { draft: unknown } }).transfer
        if (transfer)
          value = {
            ...value,
            transfer: { ...transfer, draft: mapDraft(transfer.draft) },
          }
      }
    }
    const next = JSON.stringify(value)
    if (next !== text) writes.push([key, next])
  }
  // 先完成全部解析再写入；逐项改写幂等，中断重开继续，绝不清空整个 profile。
  for (const [key, value] of writes) localStorage.setItem(key, value)
}
