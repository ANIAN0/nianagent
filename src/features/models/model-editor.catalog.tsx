import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { Button } from "@/components/ui/button"
import { ModelEditor } from "./model-editor"
import type { ModelDefinition } from "./model-types"
import "./model-settings.css"

function ModelEditorExample({
  role,
  reasoning = true,
}: {
  role?: boolean
  reasoning?: boolean
}) {
  const [draft, setDraft] = useState<ModelDefinition>(() => ({
    id: "example-vision",
    name: "示例视觉模型",
    api: "openai-completions",
    reasoning,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 65536,
    ...(role === undefined ? {} : { compat: { supportsDeveloperRole: role } }),
  }))
  const [open, setOpen] = useState(true)
  const [saved, setSaved] = useState(false)
  return (
    <div className="flex flex-col items-start gap-4 p-4">
      <Button variant="outline" onClick={() => setOpen(true)}>
        编辑示例模型
      </Button>
      <p role="status">
        {saved ? "已加入本地示例草稿" : "本地示例草稿"} · 系统说明角色：
        {draft.compat?.supportsDeveloperRole === undefined
          ? "自动（Pi 默认）"
          : draft.compat.supportsDeveloperRole
            ? "支持 developer（思考模型）"
            : "仅 system"}
      </p>
      {open && (
        <ModelEditor
          initial={draft}
          originalId={draft.id}
          existing={[draft]}
          connectionName="组件库隔离示例"
          onSave={(value) => {
            setDraft(value)
            setSaved(true)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

export default {
  id: "model-editor",
  name: "编辑模型",
  source: "src/features/models/model-editor.tsx",
  group: "设置与启动",
  layer: "复合组件",
  order: 153,
  pages: ["模型连接"],
  stage: "content",
  description: "正式模型编辑对话框，逐模型配置能力及 Pi 系统说明角色。",
  boundary:
    "直接复用 ModelEditor；保存只更新此预览的内存草稿，不接账号、模型服务或正式连接，不证明真实推理已通过。",
  story: {
    goal: "在已有模型的完整编辑流程中选择系统说明角色，加入本地草稿并重新打开核对。",
    preconditions: ["预览提供一个能力完整的隔离模型，不连接真实服务。"],
    result: "角色配置和其他能力同属模型草稿，未保存退出不会替换原值。",
  },
  standards: [
    {
      id: "M1",
      name: "逐模型原生兼容配置",
      rule: "角色未设置沿 Pi 默认，system 使用原生 false，developer 仅适用于思考模型；切换其他协议移除该选项。",
      reason: "服务的角色支持不同，不按厂商或模型名覆盖默认行为。",
      check:
        "改变角色后加入草稿并重开，值保留；改回自动后不再保存显式角色；非思考说明仍为 system。",
    },
    {
      id: "M2",
      name: "完整配置和退出",
      rule: "原有 ID、能力和独立 token 上限验证与未保存退出确认共用正式组件。",
      reason: "兼容设置属于当前模型草稿，不能绕过保存连接前的既有编辑流程。",
      check:
        "在窄窗能滚动全部字段，标题及操作仍可到达；取消未保存修改不替换原草稿。",
    },
  ],
  inputs: ["initial / originalId / existing / connectionName"],
  events: ["onSave 加入连接草稿；onClose 关闭，不写正式连接"],
  composition: [
    "ModelEditor / Dialog / Field / Select / RadioGroup / Checkbox / Input",
  ],
  consumers: ["ConnectionEditor"],
  states: [
    {
      id: "auto",
      name: "Pi 默认",
      section: "normal",
      condition: "已有模型没有显式角色配置。",
      steps: ["选择仅 system，加入本地示例草稿后重开；再改回自动并加入草稿。"],
      expected: "用户选择保留，自动不保存显式角色。",
      render: () => <ModelEditorExample />,
    },
    {
      id: "system",
      name: "仅 system",
      section: "exception",
      condition: "思考模型显式保存 supportsDeveloperRole=false。",
      steps: ["核对仅 system，修改后取消，并在确认框放弃修改。"],
      expected: "初始 false 正确显示，放弃后原草稿仍保持 system。",
      render: () => <ModelEditorExample role={false} />,
    },
    {
      id: "developer",
      name: "支持 developer",
      section: "normal",
      condition: "思考模型显式支持 developer。",
      steps: ["核对角色和思考能力；改为其他接口并加入本地示例草稿。"],
      expected: "其他接口不保留 Chat Completions 角色配置。",
      render: () => <ModelEditorExample role />,
    },
    {
      id: "non-reasoning",
      name: "非思考模型",
      section: "states",
      condition: "原生 supportsDeveloperRole=true，但模型不支持思考。",
      steps: ["查看角色说明；切换思考能力，检查说明随真实草稿更新。"],
      expected: "明确非思考模型仍使用 system，不承诺强制 developer。",
      render: () => <ModelEditorExample role reasoning={false} />,
    },
  ],
  viewport: { width: 760, height: 760 },
} satisfies CatalogEntry
