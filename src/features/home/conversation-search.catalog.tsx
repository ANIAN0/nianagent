import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConversationSearch } from "./conversation-search"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({ empty = false }: { empty?: boolean }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>搜索会话</Button>
      <ConversationSearch
        data={{
          ...homeData,
          conversations: empty ? [] : homeData.conversations,
        }}
        open={open}
        onOpenChange={setOpen}
        onSelect={(item) => setSelected(item.title)}
      />
      <p role="status">{selected}</p>
    </div>
  )
}
export default {
  id: "conversation-search",
  name: "会话搜索",
  layer: "复合组件",
  group: "侧栏导航",
  source: "src/features/home/conversation-search.tsx",
  description: "搜索会话名称、完整路径或消息，显示计数、时间和匹配高亮。",
  boundary: "开关由页面控制，每次打开重置查询；选择后关闭并回调。",
  inputs: ["data、open。"],
  events: ["onOpenChange、onSelect。"],
  composition: ["Dialog", "InputGroup", "Button"],
  consumers: ["HomePage"],
  viewport: { width: 640, height: 520 },
  states: [
    {
      id: "search",
      name: "搜索与选择",
      condition: "多组会话。",
      expected: "输入过滤、清空恢复；方向键定位、Enter选择，重新打开重置。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "空结果",
      condition: "会话为空。",
      expected: "无历史显示暂无会话，有历史但未命中显示未找到相关会话。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
