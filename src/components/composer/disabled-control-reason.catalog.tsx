import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { DisabledControlReason } from "./disabled-control-reason"
import { Button } from "@/components/ui/button"
import { SlidersHorizontal } from "lucide-react"
export default {
  id: "disabled-control-reason",
  name: "禁用原因",
  layer: "复合组件",
  group: "工作输入",
  source: "src/components/composer/disabled-control-reason.tsx",
  description: "禁用操作仍支持键盘和鼠标了解具体原因。",
  boundary: "承载明确的当前业务原因，不自行推断禁用条件。",
  inputs: ["reason、label、children（禁用按钮）。"],
  events: ["Tab可聚焦解释节点，Enter/空格不执行禁用操作。"],
  composition: ["Tooltip", "TooltipTrigger", "TooltipContent"],
  consumers: ["SessionConfig"],
  viewport: { width: 480, height: 240 },
  states: [
    {
      id: "blocked",
      name: "发送结果待确认",
      condition: "发送尚未核对，配置禁用。",
      expected: "悬浮与键盘焦点都说明应先检查原消息，无等待回复的错误说法。",
      render: () => (
        <div className="p-12">
          <DisabledControlReason
            label="会话配置暂不可修改"
            reason="先检查原消息的发送状态，再修改会话配置。"
          >
            <Button disabled variant="ghost">
              <SlidersHorizontal />
              会话配置
            </Button>
          </DisabledControlReason>
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
