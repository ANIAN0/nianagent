import { useState } from "react"
import { ComposerToolbar } from "./composer-toolbar"
import { InputGroup } from "@/components/ui/input-group"
import type { HomeDraft } from "./home-types"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ unavailable = false }: { unavailable?: boolean }) {
  const [draft, setDraft] = useState<HomeDraft>({
    text: "演示需求",
    workspaceId: "demo",
    model: homeData.models[0]!,
    thinking: "中等",
    materials: [],
    session: {
      toolIds: homeData.tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  })
  const [result, setResult] = useState("尚未提交")
  return (
    <form
      className="p-4"
      onSubmit={(event) => {
        event.preventDefault()
        setResult(
          `${draft.model} · ${draft.thinking} · 工具 ${draft.session.toolIds.length} 个`
        )
      }}
    >
      <InputGroup>
        <ComposerToolbar
          data={
            unavailable ? { models: [], materials: [], tools: [] } : homeData
          }
          draft={draft}
          canSubmit={!unavailable}
          onChange={(patch) => setDraft((old) => ({ ...old, ...patch }))}
          onAddMaterial={(item) =>
            setDraft((old) => ({ ...old, materials: [...old.materials, item] }))
          }
        />
      </InputGroup>
      <p role="status" className="mt-4 text-sm">
        {result} · 已选材料 {draft.materials.length}
      </p>
    </form>
  )
}
export default {
  id: "composer-toolbar",
  name: "输入工具栏",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/composer-toolbar.tsx",
  description: "将材料、模型、思考、会话配置与发送动作安排在输入区底部。",
  boundary:
    "全部草稿受控；负责操作排列与回调转发，验证和去重由 HomeComposer 处理。必须置于 InputGroup 与 form 内。",
  props: [
    {
      name: "data",
      type: "Pick<HomeData, 'materials' | 'models' | 'tools'>",
      default: "必填",
      description: "候选资源。",
    },
    {
      name: "draft",
      type: "HomeDraft",
      default: "必填",
      description: "父级唯一草稿。",
    },
    {
      name: "canSubmit",
      type: "boolean",
      default: "必填",
      description: "父级校验结果。",
    },
    {
      name: "onChange",
      type: "(patch: Partial<HomeDraft>) => void",
      default: "必填",
      description: "更新模型、思考或工具选项。",
    },
    {
      name: "onAddMaterial",
      type: "(material: Material) => void",
      default: "必填",
      description: "通知添加材料。",
    },
  ],
  inputs: ["data、draft、canSubmit"],
  events: ["onChange(patch)、onAddMaterial(material)、所属 form submit。"],
  composition: [
    "MaterialPicker",
    "ModelPicker",
    "SessionConfig",
    "SendControl",
    "InputGroupAddon",
  ],
  consumers: ["HomeComposer"],
  viewport: { width: 560, height: 300 },
  states: [
    {
      id: "ready",
      name: "配置与发送",
      condition: "有效草稿与资源。",
      expected:
        "修改选择后发送，摘要反映当前选项。模型/思考共用入口；窄屏省略配置文字，四个操作位置保留。",
      render: () => <Example />,
    },
    {
      id: "unavailable",
      name: "资源不可用",
      condition: "没有材料或模型。",
      expected: "资源入口与发送禁用，配置仍可操作。",
      render: () => <Example unavailable />,
    },
  ],
} satisfies CatalogEntry
