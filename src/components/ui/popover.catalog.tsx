import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "./button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "./popover"
function Example() {
  return (
    <div className="p-6">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">打开浮层</Button>
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>选项面板</PopoverTitle>
            <PopoverDescription>
              焦点进入浮层，Escape 关闭并回到触发器。
            </PopoverDescription>
          </PopoverHeader>
          <Button variant="ghost">可聚焦操作</Button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
export default {
  id: "popover",
  name: "Popover",
  layer: "基础组件",
  group: "浮层",
  source: "src/components/ui/popover.tsx",
  description: "锚定触发器的非模态面板。",
  boundary: "由 Radix 管理定位、外部点击与焦点恢复；内容由调用方组合。",
  inputs: ["open/defaultOpen、align、sideOffset。"],
  events: ["onOpenChange、onEscapeKeyDown。"],
  composition: ["Radix Popover"],
  consumers: ["ModelPicker"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "open-close",
      name: "打开与关闭",
      condition: "初始关闭。",
      expected: "打开后内容可操作；外部点击/Esc 关闭并正确恢复焦点。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
