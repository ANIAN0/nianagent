import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DirectoryPicker } from "./directory-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
function Example({
  empty = false,
  allowCreate = true,
}: {
  empty?: boolean
  allowCreate?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState("")
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>选择工作目录</Button>
      <DirectoryPicker
        allowCreate={allowCreate}
        open={open}
        onOpenChange={setOpen}
        directories={empty ? [] : homeData.workspaces}
        onSelect={(item) => setPath(item.path)}
      />
      <p role="status">{path}</p>
    </div>
  )
}
export default {
  id: "directory-picker",
  name: "目录浏览弹窗",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/directory-picker.tsx",
  description: "浏览目录、编辑路径、创建内存文件夹并确认工作目录。",
  boundary:
    "只负责已有工作区选择和路径输入，不读写磁盘；真实模式由后端校验目录，禁用内存文件夹创建。",
  inputs: [
    "directories、open；allowCreate=false 用于真实工作区，不显示模拟创建。",
  ],
  events: ["onSelect(workspace)、onOpenChange。"],
  composition: ["Dialog", "Input", "Checkbox", "Button"],
  consumers: ["WorkspacePicker"],
  viewport: { width: 760, height: 600 },
  states: [
    {
      id: "existing",
      name: "已有本地目录",
      condition: "真实服务只接受已存在目录。",
      expected: "可输入绝对路径，不显示模拟新建文件夹。",
      render: () => <Example empty allowCreate={false} />,
    },
    {
      id: "browse",
      name: "浏览与添加",
      condition: "存在示例工作区。",
      expected: "进入目录后可打开；编辑路径和创建文件夹可操作；取消不回写。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无目录",
      condition: "列表为空。",
      expected: "可编辑路径或新建内存文件夹，打开前确认有效路径。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
