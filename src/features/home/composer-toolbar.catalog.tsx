import { useState } from "react"
import { ComposerToolbar } from "./composer-toolbar"
import { ComposerInputCard } from "@/components/composer/composer-input-card"
import { ComposerPanelProvider } from "./composer-panel-context"
import { PromptInput } from "./prompt-input"
import { ConversationSendControl } from "@/features/conversation/composer/conversation-send-control"
import type { HomeDraft } from "./home-types"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  unavailable = false,
  longModel = false,
  locked = false,
  running = false,
}: {
  unavailable?: boolean
  longModel?: boolean
  locked?: boolean
  running?: boolean
}) {
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
      <ComposerPanelProvider>
        <ComposerInputCard>
          <PromptInput
            value={draft.text}
            onChange={(text) => setDraft((old) => ({ ...old, text }))}
            onSubmit={() => {}}
          />
          <ComposerToolbar
            data={
              unavailable
                ? { models: [], materials: [], tools: [] }
                : longModel
                  ? {
                      ...homeData,
                      modelLabels: {
                        [homeData.models[0]!]:
                          "同名模型-超长服务版本标识-2026-October-Enterprise",
                      },
                    }
                  : homeData
            }
            modelDisabled={locked}
            modelDisabledReason="当前工作仍在运行，停止后可修改模型与思考强度。"
            configurationDisabled={locked}
            configurationDisabledReason="当前工作仍在运行，停止后可修改工具与项目指令。"
            sendControl={
              running ? (
                <ConversationSendControl
                  running
                  hasDraft
                  disabled={unavailable}
                  onStop={() => setResult("已请求停止（展示）")}
                />
              ) : undefined
            }
            draft={draft}
            canSubmit={!unavailable}
            onChange={(patch) => setDraft((old) => ({ ...old, ...patch }))}
            onAddMaterial={(item) =>
              setDraft((old) => ({
                ...old,
                materials: [...old.materials, item],
              }))
            }
          />
        </ComposerInputCard>
      </ComposerPanelProvider>
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
    "全部草稿受控；负责操作排列与回调转发，验证和去重由页面控制器与共享草稿policy处理。必须置于 InputGroup 与 form 内。",
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
  inputs: [
    "data、draft、canSubmit；disabled关闭全部入口；modelDisabled与configurationDisabled分别锁模型和配置；sendControl可组合会话主动作，materialsDisabled控制材料。需要ComposerPanelProvider协调展开与焦点。",
  ],
  events: ["onChange(patch)、onAddMaterial(material)、所属 form submit。"],
  composition: [
    "MaterialPicker",
    "ModelPicker",
    "SessionConfig",
    "SendControl",
    "InputGroupAddon",
  ],
  consumers: ["HomeComposer", "ConversationComposer"],
  viewport: { width: 560, height: 300 },
  states: [
    {
      id: "ready",
      name: "配置与发送",
      condition: "有效草稿与资源。",
      expected:
        "修改选择后发送，摘要反映当前选项。模型/思考共用入口；窄屏省略配置与思考辅助文字；左右操作组可换行，主动作保留。",
      render: () => <Example />,
    },
    {
      id: "long-name",
      name: "长模型与窄窗口",
      condition: "长模型名称；将展示宽度收至 320px。",
      expected:
        "模型/思考整组收缩；先弱化思考文字，不挤掉配置图标或主发送；卡片无横向滚动。",
      render: () => <Example longModel />,
    },
    {
      id: "running-draft",
      name: "运行中下一稿",
      condition: "输入有可排队的下一稿，运行模型与配置锁定。",
      expected: "同一工具栏显示主排队与低强调停止；模型/配置可读取明确锁原因。",
      render: () => <Example running locked />,
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
