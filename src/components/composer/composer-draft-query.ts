import type { Material } from "@/features/home/home-types"

/** Sending is only allowed after active resource/command claims are resolved. */
export function unresolvedComposerQuery(text: string, materials: Material[]) {
  for (const match of text.matchAll(/(^|\s)@(?:"([^"\r\n]*)"?|([^\s@]*))/gu)) {
    if (match[2] !== undefined && !match[0].endsWith('"'))
      return "请完成文件引用，或从候选中重新选择。"
    const path = (match[2] ?? match[3] ?? "")
      .replaceAll("\\", "/")
      .toLowerCase()
    if (
      !path ||
      !materials.some(
        (item) =>
          item.status === "ready" &&
          item.source &&
          (item.source.replaceAll("\\", "/").toLowerCase() === path ||
            item.source
              .replaceAll("\\", "/")
              .toLowerCase()
              .endsWith(`/${path}`))
      )
    )
      return "请从候选中选择文件或目录，或移除未完成的 @ 引用。"
  }
  const command = text.trimStart().match(/^\/([^\s]*)/u)?.[1]
  if (
    command !== undefined &&
    command !== "compact" &&
    !materials.some(
      (item) =>
        item.type === "skill" &&
        item.status === "ready" &&
        command === `skill:${item.name}`
    )
  )
    return "请从候选中选择可用的 Skill，或移除未完成的命令。"
  return undefined
}
