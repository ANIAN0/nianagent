import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationGroup } from "./conversation-group"
import { homeData } from "../../../ui-catalog/fixtures/home"

function Example({ initialExpanded = true }: { initialExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const [event, setEvent] = useState("尚未选择会话")
  return (
    <div className="p-4">
      <ConversationGroup
        workspace={homeData.workspaces[0]!}
        conversations={[
          ...homeData.conversations.filter(
            (item) => item.workspaceId === "demo"
          ),
          {
            id: "long",
            workspaceId: "demo",
            title: "很长的历史会话标题用于检查按钮截断与完整标题提示",
          },
        ]}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        onNew={(id) => setEvent(`在 ${id} 新建会话`)}
        onSelect={(item) => setEvent(item.title)}
      />
      <p role="status">{event}</p>
    </div>
  )
}
export default {
  id: "conversation-group",
  name: "目录会话分组",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-group.tsx",
  description: "展示一个工作目录的折叠按钮和会话条目。",
  boundary: "展开状态受控；不执行搜索或路由。",
  inputs: ["workspace；conversations；expanded。"],
  events: ["onToggle()；onSelect(conversation)；onNew?(workspaceId)。"],
  composition: ["Button", "ConversationItem"],
  consumers: ["ConversationHistory"],
  viewport: { width: 300, height: 420 },
  states: [
    {
      id: "expanded",
      name: "展开目录",
      condition: "包含普通和长标题会话。",
      expected:
        "标题截断，选中返回会话，点击目录折叠；悬停或键盘定位显示目录新建入口。",
      render: () => <Example />,
    },
    {
      id: "collapsed",
      name: "折叠目录",
      condition: "初始折叠。",
      expected: "隐藏条目，点击目录恢复。",
      render: () => <Example initialExpanded={false} />,
    },
  ],
} satisfies CatalogEntry
