import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { WorkspacePicker } from "./workspace-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"

function Example({ empty = false }: { empty?: boolean }) {
  const [value, setValue] = useState(homeData.workspaces[0]!.id)
  return (
    <div className="p-6">
      <WorkspacePicker
        workspaces={empty ? [] : homeData.workspaces}
        value={value}
        onChange={setValue}
      />
      <p role="status">目录：{value}</p>
    </div>
  )
}
export default {
  id: "workspace-picker",
  name: "工作目录选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/workspace-picker.tsx",
  description: "紧凑目录菜单，单行名称与尾部勾选，底部添加工作区。",
  boundary: "受控选择；不读写文件系统。",
  inputs: [
    "workspaces: Workspace[]；value: 工作目录 id；allowCreate=false 禁用目录弹窗的模拟新建。",
  ],
  events: ["onChange(id)：更新草稿；onAdd(workspace)：向父级登记新目录。"],
  composition: ["Button", "DropdownMenu", "DirectoryPicker"],
  consumers: ["HomeComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "available",
      name: "目录切换",
      condition: "提供两个目录。",
      expected: "菜单显示名称和当前项；悬停可查看路径；添加工作区后可切换。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "无工作目录",
      condition: "目录列表为空。",
      expected: "入口可用，可添加工作区。",
      render: () => <Example empty />,
    },
  ],
} satisfies CatalogEntry
