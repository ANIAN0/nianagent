import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import type { HomeDraft } from "@/features/home/home-types"
import { ConversationComposer } from "./conversation-composer"
function Example({
  running: initialRunning = false,
  material = false,
  blocked = false,
}: {
  running?: boolean
  material?: boolean
  blocked?: boolean
}) {
  const [running, setRunning] = useState(initialRunning)
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState<HomeDraft>({
    workspaceId: homeData.workspaces[0].id,
    text: material ? "结合附件继续检查" : "",
    model: homeData.models[0],
    thinking: "中等",
    materials: material ? [homeData.materials[0]] : [],
    session: {
      toolIds: homeData.tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  })
  return (
    <div className="flex min-h-96 flex-col justify-end gap-3 p-4">
      <p role="status">
        {blocked ? "连接已断开，草稿仍可编辑，恢复后再发送。" : notice}
      </p>
      <ConversationComposer
        data={homeData}
        draft={draft}
        workspacePath={homeData.workspaces[0].path}
        onChange={setDraft}
        running={running}
        blocked={blocked}
        onSubmit={(value) => {
          setNotice(running ? `已排队：${value.text}` : `已发送：${value.text}`)
          setRunning(true)
          setDraft({ ...value, text: "", materials: [] })
        }}
        onStop={() => {
          setRunning(false)
          setNotice("已停止执行")
        }}
      />
    </div>
  )
}
export default {
  id: "conversation-composer",
  name: "对话输入区",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/composer/conversation-composer.tsx",
  description: "固定在会话下方的受控草稿，复用首页材料、模型、思考和会话配置。",
  boundary:
    "只编辑HomeDraft并发出发送/停止事件；不调用模型。父级按会话保存草稿与队列。",
  inputs: [
    "data: 模型、材料与工具选项；draft/onChange: 完整受控草稿。",
    "running/stopping: 执行阶段；dock: 队列；workspacePath: 配置中的工作目录。",
    "blocked: 禁止发送与排队，仍可编辑和保留草稿；运行时停止不受影响。",
  ],
  events: [
    "Enter发送/排队、Shift+Enter换行；输入法组合不提交。",
    "运行空草稿为停止；运行有草稿为排队；停止中禁止重复操作。",
  ],
  composition: [
    "InputGroup、FieldGroup/Field、MaterialPicker、ModelPicker、SessionConfig、SelectedMaterials、ConversationSendControl",
  ],
  consumers: ["ConversationPage"],
  viewport: { width: 880, height: 520 },
  states: [
    {
      id: "blocked",
      name: "断线保留草稿",
      condition: "连接中断禁发。",
      expected: "草稿可编辑，点击发送与Enter均不会提交。",
      render: () => <Example blocked material />,
    },
    {
      id: "idle",
      name: "空闲输入",
      condition: "空草稿",
      expected: "发送禁用，输入后可发送；弹层与首页一致。",
      render: () => <Example />,
    },
    {
      id: "running",
      name: "运行与排队",
      condition: "模拟正在执行",
      expected: "空输入停止，输入后变为排队，草稿不丢失。",
      render: () => <Example running />,
    },
    {
      id: "materials",
      name: "附带材料",
      condition: "已选材料和文字",
      expected: "可删除材料、修改文本并发送。",
      render: () => <Example material />,
    },
  ],
} satisfies CatalogEntry
