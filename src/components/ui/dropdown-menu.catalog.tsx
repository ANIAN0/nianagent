import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./dropdown-menu"
import { useState } from "react"
import { Button } from "./button"
function Example() {
  const [value, setValue] = useState("尚未选择")
  return (
    <div className="p-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>打开操作菜单</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>演示操作</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setValue("已选择")}>
              可选操作
            </DropdownMenuItem>
            <DropdownMenuItem disabled>禁用操作</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setValue("已重置")}>
              重置输出
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p role="status">{value}</p>
    </div>
  )
}
export default {
  id: "dropdown-menu",
  name: "DropdownMenu",
  layer: "基础组件",
  group: "弹层",
  source: "src/components/ui/dropdown-menu.tsx",
  description: "通过弹出菜单选择动作。",
  boundary: "菜单项放入 Group；Trigger asChild 复用按钮。",
  inputs: ["children；open/onOpenChange（可受控）。"],
  events: ["DropdownMenuItem.onSelect。"],
  composition: ["Radix DropdownMenu"],
  consumers: ["WorkspacePicker", "MaterialPicker", "UserMenu"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "actions",
      name: "菜单操作",
      condition: "包含可选与禁用项。",
      expected: "打开/关闭、方向键、选择回调与禁用正常。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
