import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "@/components/ui/button"
import {
  ConversationList,
  type ConversationReadingPosition,
} from "./conversation-list"
import { ConversationTurnView } from "./messages/conversation-turn-view"
import { MessageEnvironmentProvider } from "./messages/message-environment"
import type { ConversationChatMessage } from "@/features/models/model-contract.generated"
import { projectConversationTurns } from "./conversation-turns"

function Example({
  count = 6,
  restore = false,
}: {
  count?: number
  restore?: boolean
}) {
  const [selected, setSelected] = useState("A")
  const [version, setVersion] = useState(0)
  const [positions] = useState(
    () => new Map<string, ConversationReadingPosition>()
  )
  const [disclosures] = useState(
    () =>
      new Map([
        ["A", new Map<string, boolean>()],
        ["B", new Map<string, boolean>()],
      ])
  )
  const messages: ConversationChatMessage[] = Array.from(
    { length: count },
    (_, index) => {
      const userId = "catalog-" + selected + "-user-" + index
      return [
        {
          id: userId,
          userTurnId: userId,
          historyIndex: index * 3,
          role: "user" as const,
          status: "settled" as const,
          text: "第 " + (index + 1) + " 轮：核对原型的交互与阅读位置",
          time: "2026-10-04T02:20:00.000Z",
        },
        {
          id: "catalog-" + selected + "-answer-" + index,
          userTurnId: userId,
          historyIndex: index * 3 + 1,
          role: "assistant" as const,
          status: "settled" as const,
          stopReason: "stop" as const,
          text:
            "## 第 " +
            (index + 1) +
            " 轮结果\n\n保持正文阅读宽度，逐项核对阅读位置。\n\n" +
            "已保存条目的身份保持稳定，更新末条文字不会重置其他轮次。\n\n".repeat(
              3
            ) +
            (index === count - 1 ? "更新版本：" + version : ""),
          time: "2026-10-04T02:20:03.000Z",
          model: "DeepSeek-V4-Flash",
          blocks: [
            {
              id: "catalog-" + selected + "-tool-" + index,
              type: "tool" as const,
              tool: {
                id: "catalog-call-" + index,
                occurrenceId: "catalog-" + selected + "-occurrence-" + index,
                name: "read",
                source: "Pi",
                status: "success" as const,
                input: '{"path":"README.md"}',
                result: "已保存的内容演示",
                target: {
                  kind: "file" as const,
                  path: "H:/workspace/moon/README.md",
                  displayPath: "README.md",
                },
              },
            },
            {
              id: "catalog-" + selected + "-text-" + index,
              type: "text" as const,
              phase: "settled" as const,
              text:
                "## 第 " +
                (index + 1) +
                " 轮结果\n\n" +
                "按稳定轮次阅读，不替换已展开工具的身份。\n\n".repeat(3) +
                (index === count - 1 ? "更新版本：" + version : ""),
            },
          ],
        },
      ]
    }
  ).flat()
  const turns = projectConversationTurns(messages)
  return (
    <div className="flex h-dvh min-h-0 flex-col">
      {restore && (
        <div className="flex shrink-0 gap-2 p-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(selected === "A" ? "B" : "A")}
          >
            切换到会话 {selected === "A" ? "B" : "A"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVersion(version + 1)}
          >
            更新末条回复
          </Button>
          <span className="text-xs text-muted-foreground">
            会话 {selected} · 阅读与展开按会话保存
          </span>
        </div>
      )}
      <div className="conversation-body min-h-0 flex-1">
        <MessageEnvironmentProvider
          key={selected}
          value={{
            sessionId: selected,
            cwd: "H:/workspace/moon",
            disclosures: disclosures.get(selected)!,
          }}
        >
          <ConversationList
            key={selected}
            initialPosition={positions.get(selected)}
            onPositionChange={(position) => positions.set(selected, position)}
            items={turns.map((turn, index) => ({
              id: turn.id,
              turn: index + 1,
              prompt: turn.user!.text,
              response: turn.response,
              content: (
                <ConversationTurnView
                  turn={turn}
                  latest={index === turns.length - 1}
                />
              ),
            }))}
          />
        </MessageEnvironmentProvider>
      </div>
    </div>
  )
}
export default {
  id: "conversation-list",
  name: "对话消息列表",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/conversation-list.tsx",
  description: "官方 MessageScroller、稳定用户轮次、会话阅读锚点和最右轮次轨。",
  boundary:
    "只管理阅读与定位；正式DTO结构的合约演示不声称真实Pi调用结果。工具展开归会话/块身份，滚动由官方组件负责。",
  inputs: [
    "items：稳定轮次id与真实轮末摘要",
    "initialPosition：锚点/偏移/跟随",
  ],
  events: ["onPositionChange", "轮次跳转与键盘导航"],
  composition: [
    "MessageScrollerProvider",
    "MessageScroller",
    "ConversationNavigator",
    "ConversationTurnView",
  ],
  consumers: ["ConversationPage"],
  viewport: { width: 1280, height: 720 },
  states: [
    {
      id: "long",
      name: "多轮阅读",
      condition: "6轮完整DTO结构。",
      expected: "首次到末尾；上滚暂停跟随，最右轨可定位，返回最新按钮正确。",
      render: () => <Example />,
    },
    {
      id: "two-hundred",
      name: "200轮与最右轨",
      condition: "200个完整用户轮次、过程和最终回复。",
      expected:
        "当前项在轨中可见；方向键/Home/End只移动轨焦点，点击定位正文；按实际渲染测量评价成本。",
      render: () => <Example count={200} />,
    },
    {
      id: "restore",
      name: "跨会话恢复阅读和展开",
      condition: "A/B各30轮；旧轮打开工具并停在正文中部后切换。",
      expected: "返回原会话还原锚点/偏移和工具展开；更新末条不抢旧轮阅读。",
      render: () => <Example count={30} restore />,
    },
  ],
} satisfies CatalogEntry
