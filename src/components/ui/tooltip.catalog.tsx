import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./tooltip"
import { Button } from "./button"
export default {
  id: "tooltip",
  name: "提示 Tooltip",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/ui/tooltip.tsx",
  description: "为图标操作提供悬停与聚焦说明。",
  boundary: "不放置交互内容，复杂信息使用Popover。",
  inputs: ["children、side"],
  events: ["悬停、聚焦打开；Escape关闭。"],
  composition: ["Radix Tooltip"],
  consumers: ["MessageActions、CopyButton"],
  viewport: { width: 420, height: 200 },
  states: [
    {
      id: "default",
      name: "悬停或聚焦",
      condition: "带文字提示的按钮。",
      expected: "键盘焦点和鼠标悬停均显示提示。",
      render: () => (
        <TooltipProvider>
          <div className="p-16">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">操作</Button>
              </TooltipTrigger>
              <TooltipContent>操作说明</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      ),
    },
  ],
} satisfies CatalogEntry
