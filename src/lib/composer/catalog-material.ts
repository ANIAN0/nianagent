import type { Material } from "@/lib/composer/types"

/** 仅供组件目录的展示适配；示例服务负责准备，不能作为正式 RPC 身份。 */
export function catalogMaterial(
  value: Pick<Material, "id" | "name" | "kind"> &
    Partial<Omit<Material, "id" | "name" | "kind">>
): Material {
  return {
    type:
      value.kind === "Skill"
        ? "skill"
        : /\.(png|jpg|jpeg|gif|webp)$/i.test(value.name)
          ? "image"
          : "file",
    status: "ready",
    source: `H:/workspace/moon/${value.name}`,
    ...value,
  }
}
