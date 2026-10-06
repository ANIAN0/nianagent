import type { Material } from "@/features/home/home-types"

/** Only a leading command is a command claim; unselected inline tokens are text. */
export function unresolvedComposerQuery(
  text: string,
  _materials: Material[],
  extensionCommand?: string
) {
  const leading = text.trimStart()
  if (/^\/skill:[^\s]+/u.test(leading)) return undefined
  if (leading.startsWith("/skill:"))
    return "请补全 Skill 名称，或移除未完成的前缀。"
  const match = leading.match(/^\/([\p{L}\p{N}_-]*)(?=\s|$)/u)
  if (!match) return undefined
  const command = match[1]
  if (command !== "compact" && command !== extensionCommand)
    return "请从候选中选择可用命令或 Skill，或移除未完成的命令。"
  return undefined
}
