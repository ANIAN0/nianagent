import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import type { Workspace } from "./home-types"
import { WorkspacePicker } from "./workspace-picker"
import { homeData } from "../../../ui-catalog/fixtures/home"

type ExampleState =
  "available" | "empty" | "unavailable" | "loading" | "error" | "cancel"
function Example({ state = "available" }: { state?: ExampleState }) {
  const [value, setValue] = useState(
    state === "empty" ? "" : homeData.workspaces[0]!.id
  )
  const [items, setItems] = useState<Workspace[]>(
    state === "empty"
      ? []
      : homeData.workspaces.map((item, index) => ({
          ...item,
          available: !(state === "unavailable" && index === 0),
          unavailableReason:
            state === "unavailable" && index === 0
              ? "工作目录不存在或不可访问，请重新选择。"
              : "",
        }))
  )
  const [attempted, setAttempted] = useState(false)
  const [status, setStatus] = useState("")
  return (
    <div className="p-6">
      <WorkspacePicker
        workspaces={items}
        value={value}
        loading={state === "loading"}
        onChange={setValue}
        onChooseDirectory={async () => {
          if (state === "error" && !attempted) {
            setAttempted(true)
            throw new Error("工作区保存失败，请重试。")
          }
          if (state === "cancel") {
            setStatus("已取消，工作目录保持不变。")
            return
          }
          const item = {
            id: "chosen-demo",
            name: "新的演示目录",
            path: "H:/demo/project",
            available: true,
            unavailableReason: "",
          }
          setItems((current) =>
            current.some((record) => record.id === item.id)
              ? current
              : [...current, item]
          )
          setValue(item.id)
          setStatus("已添加并选中演示目录。")
        }}
      />
      <p role="status" className="text-sm text-muted-foreground">
        {status ||
          `当前工作区：${items.find((item) => item.id === value)?.name ?? "未选择"}`}
      </p>
    </div>
  )
}
export default {
  id: "workspace-picker",
  name: "工作目录选择",
  layer: "复合组件",
  group: "工作输入",
  source: "src/features/home/workspace-picker.tsx",
  description:
    "紧凑目录菜单，保留名称、尾部勾选和底部添加；正式页面直接打开系统目录选择器。",
  boundary:
    "受控目录、异步选择与添加；不保存独立目录副本。原生能力经注入回调调用，组件库使用内存替身，不打开系统窗。",
  inputs: [
    "workspaces/value：正式目录与当前选择；available=false 的记录保留并禁选。",
    "loading/error/disabled/onRetry：读取状态与恢复入口。",
  ],
  events: [
    "onChange(id,signal)：持久化成功后父级更新选择。",
    "onChooseDirectory(signal)：父级打开系统窗，取消不变，成功登记并更新目录和选择。",
  ],
  composition: ["Button", "DropdownMenu", "Alert"],
  consumers: ["HomeComposer"],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "available",
      name: "目录切换",
      condition: "已有两个目录。",
      expected: "保留单行名称与勾选；添加使用注入的目录选择能力。",
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "尚无目录",
      condition: "真实目录列表为空。",
      expected: "入口保留添加工作区操作，添加后选中。",
      render: () => <Example state="empty" />,
    },
    {
      id: "unavailable",
      name: "目录失效",
      condition: "当前目录被删除或无权限。",
      expected: "明确原因，失效行不可选；可切换到可用目录。",
      render: () => <Example state="unavailable" />,
    },
    {
      id: "loading",
      name: "读取中",
      condition: "正在恢复工作区。",
      expected: "读取反馈，禁止重复操作。",
      render: () => <Example state="loading" />,
    },
    {
      id: "error",
      name: "添加失败后重试",
      condition: "第一次添加失败。",
      expected: "保留原选择，重试后成功。",
      render: () => <Example state="error" />,
    },
    {
      id: "cancel",
      name: "取消系统选择",
      condition: "目录选择替身返回取消。",
      expected: "无新目录、无错误提示、原选择不变。",
      render: () => <Example state="cancel" />,
    },
  ],
} satisfies CatalogEntry
