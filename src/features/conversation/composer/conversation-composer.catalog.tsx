import { useState } from "react"
import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import type { HomeDraft } from "@/features/home/home-types"
import { ConversationComposer } from "./conversation-composer"
import { QueueDock } from "./queue-dock"
function Example({
  running: initialRunning = false,
  material = false,
  blocked = false,
  command = false,
  queued = false,
  modeUnknown = false,
  long = false,
  boundSkill = false,
}: {
  running?: boolean
  material?: boolean
  blocked?: boolean
  command?: boolean
  queued?: boolean
  modeUnknown?: boolean
  long?: boolean
  boundSkill?: boolean
}) {
  const [running, setRunning] = useState(initialRunning)
  const [notice, setNotice] = useState("")
  const [deliveryMode, setDeliveryMode] = useState<"single" | "all">("single")
  const [modeIssue, setModeIssue] = useState(
    modeUnknown
      ? {
          code: "result_unknown",
          message: "交付模式尚未确认，请先核对当前模式。",
          recovery: "check" as const,
          severity: "warning" as const,
        }
      : undefined
  )
  const [draft, setDraft] = useState<HomeDraft>({
    workspaceId: homeData.workspaces[0].id,
    text: boundSkill
      ? "/skill:code-review 保留这段检查要求"
      : long
        ? "这是需要保留的下一轮需求。\n".repeat(20)
        : command
          ? "/compact 保留已确认的接口约定"
          : material
            ? "结合附件继续检查"
            : "",
    model: homeData.models[0],
    thinking: "中等",
    materials: boundSkill
      ? [
          {
            id: "catalog-skill",
            kind: "Skill",
            type: "skill",
            name: "code-review",
            description: "检查当前修改",
            status: "ready",
            source: "H:/workspace/moon/.agents/skills/code-review/SKILL.md",
          },
        ]
      : material
        ? [homeData.materials[0]]
        : [],
    session: {
      toolIds: homeData.tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  })
  const [queueItems, setQueueItems] = useState(
    queued
      ? [
          {
            id: "queued-example",
            draft: { ...draft, text: "检查上一轮生成的文档" },
          },
        ]
      : []
  )
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
        blockedReason={
          blocked ? "连接已断开，请恢复连接后再修改会话配置。" : undefined
        }
        queuedCount={queueItems.length}
        deliveryMode={deliveryMode}
        onDeliveryModeChange={setDeliveryMode}
        modeIssue={modeIssue}
        onCheckMode={() => {
          setModeIssue(undefined)
          setNotice("当前交付模式已确认（展示）")
        }}
        context={{ status: "unavailable" }}
        dock={
          queueItems.length > 0 && (
            <QueueDock
              items={queueItems}
              running={running}
              deliveryMode={deliveryMode}
              onEdit={(id, text, materials) =>
                setQueueItems((items) =>
                  items.map((item) =>
                    item.id === id
                      ? {
                          ...item,
                          draft: {
                            ...item.draft,
                            text,
                            materials: materials ?? item.draft.materials,
                          },
                        }
                      : item
                  )
                )
              }
              onRemove={(id) =>
                setQueueItems((items) => items.filter((item) => item.id !== id))
              }
              onSendNow={(id) => {
                setQueueItems((items) => items.filter((item) => item.id !== id))
                setNotice("队列消息已交付（展示）")
              }}
            />
          )
        }
        onSubmit={(value) => {
          if (/^\/compact(?:\s|$)/.test(value.text)) {
            setNotice("已触发打开压缩面板，命令草稿保留。")
            return
          }
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
  description:
    "完整受控对话输入：卡片、队列、模型、思考、配置、主动作及卡外交付和上下文。",
  boundary:
    "只编辑HomeDraft并发出发送/停止事件；不调用模型。父级按会话保存草稿与队列。",
  inputs: [
    "data: 模型、材料与工具选项；draft/onChange: 完整受控草稿。",
    "running/stopping: 执行阶段；dock: 队列；workspacePath: 配置中的工作目录。",
    "blocked: 禁止发送与排队，仍可编辑和保留草稿；运行时停止不受影响。",
    "queuedCount: 只用于交付菜单的等待数量说明；交付与上下文始终固定在输入卡下方，不因队列数量移位。",
  ],
  events: [
    "Enter/Ctrl+Enter/Cmd+Enter发送或排队，Shift+Enter换行；IME及尾窗、Alt/AltGraph、重复Enter不提交。",
    "运行中空稿或无效稿显示一个主停止；有效下一稿显示主排队及低强调停止；停止中禁止重复操作。",
    "/compact 只打开重点面板，忙时禁止排队，附带材料时保留并说明限制。",
  ],
  composition: [
    "ComposerPanelProvider、ComposerInputCard、PromptInput、ComposerToolbar、SelectedMaterials、ConversationSendControl、ComposerAuxiliaryBar、OperationFeedback",
  ],
  consumers: ["LiveConversationView"],
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
      expected:
        "空输入只有主停止；输入有效下一稿后出现主排队与低强调停止；草稿不丢失。",
      render: () => <Example running />,
    },
    {
      id: "long-running",
      name: "运行中的长草稿",
      condition: "20行草稿、当前工作仍运行。",
      expected: "正文局部滚动，停止与排队独立同时可用；底部工具栏固定。",
      render: () => <Example running long />,
    },
    {
      id: "bound-skill",
      name: "解除本条Skill",
      condition: "正文含绑定/skill:code-review，已选同名Skill。",
      expected:
        "点击Skill X同时解除对应开头命令，其余检查要求完整保留；不影响其他材料。",
      render: () => <Example boundSkill />,
    },
    {
      id: "compact",
      name: "命令打开压缩面板",
      condition: "空闲且输入 /compact 与保留重点。",
      expected: "主动作明确为打开压缩面板；触发后保留命令，不发起普通消息。",
      render: () => <Example command />,
    },
    {
      id: "compact-running",
      name: "运行中命令不能排队",
      condition: "工作进行中且存在压缩调用草稿。",
      expected: "原位说明需等待空闲；Enter不会排队命令，独立停止仍可用。",
      render: () => <Example command running />,
    },
    {
      id: "compact-materials",
      name: "命令携带材料",
      condition: "压缩命令附带不受支持的材料。",
      expected: "说明先移除材料，不丢材料或文字；移除后可以打开面板。",
      render: () => <Example command material />,
    },
    {
      id: "queued-delivery",
      name: "交付模式只有一个入口",
      condition: "已有待处理消息。",
      expected:
        "交付模式与上下文固定在输入卡下方；增删队列不移动入口，队列仅展示当前交付状态。",
      render: () => <Example running queued />,
    },
    {
      id: "materials",
      name: "附带材料",
      condition: "已选材料和文字",
      expected: "可删除材料、修改文本并发送。",
      render: () => <Example material />,
    },
    {
      id: "empty-mode-unknown",
      name: "空队列交付模式待确认",
      condition: "队列为空，模式修改回执丢失。",
      expected: "模式入口原位显示一次反馈，先核对模式，不重复写入。",
      render: () => <Example modeUnknown />,
    },
  ],
} satisfies CatalogEntry
