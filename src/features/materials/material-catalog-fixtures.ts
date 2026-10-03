import type { MaterialReference, MaterialPreview } from "@/features/models/model-contract.generated"
import type { MaterialService } from "./material-service"
export const sampleImageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg=="
export const exampleMaterials: MaterialReference[] = [
  { id: "example-file", name: "首页验收说明.md", kind: "附件", type: "file", status: "ready", source: "H:/工作区/moon/docs/首页验收说明.md", description: "docs/首页验收说明.md" },
  { id: "example-skill", name: "code-review", kind: "Skill", type: "skill", status: "ready", source: "H:/工作区/moon/.agents/skills/code-review/SKILL.md", description: "检查正确性、遗漏及修改影响" },
  { id: "example-image", name: "首页设计.png", kind: "附件", type: "image", status: "ready", source: "粘贴的图片", mimeType: "image/png", bytes: 70 },
]
export const exampleMaterialService: MaterialService = {
  choose: async () => [exampleMaterials[2]!],
  prepare: async (_sessionId, _cwd, paths) => exampleMaterials.filter((item) => paths.includes(item.source)),
  upload: async () => exampleMaterials[2]!,
  catalog: async (_sessionId, cwd, query) => ({ cwd, files: exampleMaterials.filter((item) => item.type === "file" && `${item.name} ${item.source}`.includes(query)), skills: exampleMaterials.filter((item) => item.type === "skill" && `${item.name} ${item.description}`.includes(query)), diagnostics: [] }),
  restore: async (_sessionId, _cwd, materials) => materials.map((item) => exampleMaterials.find((value) => value.id === item.id) ?? { id: item.id, name: item.name, kind: item.kind, type: item.type ?? "file", status: "failed", source: item.source ?? "", error: "引用来源已不存在，请重新选择。" }),
  preview: async (_cwd, id): Promise<MaterialPreview> => {
    const item = exampleMaterials.find((value) => value.id === id)
    if (!item) throw new Error("示例材料已不可用。")
    return { id, name: item.name, source: item.source, label: item.type === "file" ? "当前文件" : "本次内容", content: item.type === "skill" ? "# Code review\n检查改动与调用方。\n参考 references/checklist.md。" : "# 首页验收\n- Enter发送\n- Shift+Enter换行\n- 取消选择不改变草稿", mimeType: item.mimeType ?? "", data: item.type === "image" ? sampleImageData : "", truncated: false }
  },
}
